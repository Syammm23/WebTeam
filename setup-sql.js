/* The copy button on setup-sql.html.

   A separate file rather than an inline script because the page's
   Content-Security-Policy says scripts come from this origin and nowhere
   else, and that is worth more than saving a request. */
(function () {
  'use strict';

  var pre  = document.getElementById('sql');
  var said = document.getElementById('said');

  function say(text) {
    said.textContent = text;
    window.setTimeout(function () { said.textContent = ''; }, 4000);
  }

  function selectAll() {
    var range = document.createRange();
    range.selectNodeContents(pre);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  document.getElementById('copy').addEventListener('click', function () {
    var text = pre.textContent;

    // navigator.clipboard needs a secure context. The live site is https, but
    // if this is ever opened over plain http the older command still works.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () { say('Copied — now paste it into the SQL Editor.'); },
        function () { selectAll(); say('Could not copy for you. It is selected — copy it yourself.'); }
      );
      return;
    }

    selectAll();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    say(ok ? 'Copied — now paste it into the SQL Editor.'
           : 'Could not copy for you. It is selected — copy it yourself.');
  });

  document.getElementById('select').addEventListener('click', function () {
    selectAll();
    say('Selected. Long-press and choose Copy.');
  });
}());
