# vendor/

`supabase-js-2.116.0.js` is the official UMD build of `@supabase/supabase-js`,
copied here rather than loaded from a CDN.

It was taken from the npm tarball and checked against the hash npm publishes
for it:

    https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-2.116.0.tgz
    sha512-YyWmKXt2NspV9iO8FPnlswUFJIRnrLd3oTCb+3ZyYRuKZtBH0xCUDgnUqoyA0fGUxpM/UhfwDjYf/dht/9bp7g==

## Why not the CDN

The pages used to load `@supabase/supabase-js@2` from jsDelivr. Two problems
with that, and the second is the serious one:

  * `@2` is not a version. Whatever the newest 2.x happened to be that
    morning is what ran on the site.
  * It is the script that holds the signed-in session. Anyone able to change
    what that URL returns — a compromised CDN, a hijacked package — would be
    running code inside the admin panel, with the team's session in hand.

Served from this repository it changes only when we change it, and the
Content-Security-Policy on both pages says scripts may come from here and
nowhere else.

## Updating it

    curl -O https://registry.npmjs.org/@supabase/supabase-js/-/supabase-js-<version>.tgz
    # compare sha512 against registry.npmjs.org/@supabase/supabase-js/<version>
    tar xzf supabase-js-<version>.tgz package/dist/umd/supabase.js

Then rename it with the version in the filename, point both pages at it, and
delete the old one — the filename is what busts the browser cache.
