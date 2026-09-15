#!/usr/bin/env python3
"""Rebuild setup-sql.html from docs/supabase-admin.sql.

The page carries a copy of the script so it can be copied with one tap on a
phone. That copy goes stale the moment the SQL changes, so run this after
every edit to docs/supabase-admin.sql:

    python3 tools/build-setup-page.py

It rewrites only the <pre> block and the line count; everything else in
setup-sql.html is left alone.
"""
import html
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sql_path = ROOT / 'docs' / 'supabase-admin.sql'
page_path = ROOT / 'setup-sql.html'

sql = sql_path.read_text(encoding='utf-8')
page = page_path.read_text(encoding='utf-8')

# A lambda replacement, so a backslash or a \\1 anywhere in the SQL is copied
# across literally instead of being read as a regex escape.
block = '<pre id="sql">' + html.escape(sql) + '</pre>'
new_page = re.sub(r'<pre id="sql">.*?</pre>', lambda m: block, page, flags=re.DOTALL)
lines = len(sql.rstrip().split('\n'))
new_page = re.sub(r'<p class="count">\d+ lines\.</p>',
                  '<p class="count">%d lines.</p>' % lines, new_page)

if new_page == page:
    print('setup-sql.html already matches the SQL (%d lines).' % lines)
    sys.exit(0)

page_path.write_text(new_page, encoding='utf-8')
print('setup-sql.html rebuilt from %s (%d lines).' % (sql_path.name, lines))
