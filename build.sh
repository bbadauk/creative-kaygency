#!/bin/bash
# ============================================================================
# Creative Kaygency — Build Script
# Eliminates Babel Standalone (~1.8MB) by pre-compiling JSX to plain JS
# ============================================================================
#
# WHAT THIS DOES:
#   1. Extracts the JSX code from index.html
#   2. Compiles it to regular JavaScript using Babel CLI
#   3. Replaces <script type="text/babel"> with <script> in dist/app.html
#   4. Removes the Babel CDN script tag from dist/app.html
#   5. Result: ~1.8MB smaller download + zero compilation wait time
#
# REQUIREMENTS:
#   - Node.js 16+ (you already have this)
#   - Run from the creative-kaygency folder
#
# USAGE:
#   cd ~/Documents/Claude/Projects/Digital-Services-Agency/creative-kaygency
#   chmod +x build.sh
#   ./build.sh
#
# After running, deploy as normal (git add, commit, push)
# ============================================================================

set -e

echo ""
echo "🔨 Creative Kaygency Build Script"
echo "=================================="
echo ""

# Check we're in the right directory
if [ ! -f "index.html" ]; then
  echo "❌ Error: index.html not found. Run this from the creative-kaygency folder."
  exit 1
fi

# Step 1: Install Babel CLI locally (one-time, ~10MB)
echo "📦 Step 1/5: Installing Babel compiler..."
if [ ! -d "node_modules/@babel/cli" ]; then
  npm install --save-dev @babel/cli @babel/core @babel/preset-react @babel/plugin-transform-arrow-functions 2>/dev/null
  echo "   ✅ Babel installed"
else
  echo "   ✅ Babel already installed"
fi

# Step 2: Extract JSX code from index.html
echo "📄 Step 2/5: Extracting JSX code..."
python3 -c "
import re
with open('index.html', 'r') as f:
    content = f.read()

# Find script block
start_tag = '<script type=\"text/babel\" data-type=\"module\">'
start = content.find(start_tag)
if start == -1:
    print('   ⚠️  No text/babel script found — already compiled?')
    exit(0)

js_start = start + len(start_tag)
js_end = content.find('</script>', js_start)
js_code = content[js_start:js_end]

with open('.tmp-source.jsx', 'w') as f:
    f.write(js_code)

print(f'   ✅ Extracted {len(js_code):,} bytes of JSX')
"

if [ ! -f ".tmp-source.jsx" ]; then
  echo "   Already compiled or extraction failed."
  exit 0
fi

# Step 3: Compile JSX to JavaScript
echo "⚡ Step 3/5: Compiling JSX → JavaScript..."
npx babel .tmp-source.jsx \
  --presets=@babel/preset-react \
  --plugins=@babel/plugin-transform-arrow-functions \
  --out-file .tmp-compiled.js \
  --no-comments 2>/dev/null

COMPILED_SIZE=$(wc -c < .tmp-compiled.js)
echo "   ✅ Compiled to ${COMPILED_SIZE} bytes"

# Step 4: Rebuild dist/app.html with compiled JS
echo "🏗️  Step 4/5: Building dist/app.html..."
python3 -c "
with open('index.html', 'r') as f:
    content = f.read()
with open('.tmp-compiled.js', 'r') as f:
    compiled = f.read()

# Replace the babel script tag with regular script
start_tag = '<script type=\"text/babel\" data-type=\"module\">'
start = content.find(start_tag)
js_end = content.find('</script>', start)

new_content = content[:start] + '<script>' + compiled + content[js_end:]

# Remove the Babel CDN script (no longer needed!)
new_content = new_content.replace(
    '  <script src=\"https://unpkg.com/@babel/standalone@7.24.0/babel.min.js\" crossorigin=\"anonymous\" referrerpolicy=\"no-referrer\"></script>\n',
    '  <!-- Babel removed: JSX pre-compiled at build time -->\n'
)

# Remove the Babel preload hint
new_content = new_content.replace(
    '  <link rel=\"preload\" href=\"https://unpkg.com/@babel/standalone@7.24.0/babel.min.js\" as=\"script\" crossorigin=\"anonymous\">\n',
    ''
)

with open('dist/app.html', 'w') as f:
    f.write(new_content)

original = len(content)
new_size = len(new_content)
print(f'   ✅ dist/app.html: {new_size:,} bytes (was {original:,})')
"

# Step 5: Clean up
echo "🧹 Step 5/5: Cleaning up..."
rm -f .tmp-source.jsx .tmp-compiled.js

# Copy other static files
cp vercel.json dist/vercel.json 2>/dev/null || true
cp robots.txt dist/robots.txt 2>/dev/null || true
cp sitemap.xml dist/sitemap.xml 2>/dev/null || true
cp sw.js dist/sw.js 2>/dev/null || true

# Summary
echo ""
echo "=================================="
echo "✅ Build complete!"
echo ""
echo "BEFORE (with Babel Standalone):"
echo "  • Page download: ~1.2MB + 1.8MB Babel = ~3MB"
echo "  • Browser must compile JSX: 2-5 seconds"
echo ""
echo "AFTER (pre-compiled):"
echo "  • Page download: ~1.2MB (no Babel needed)"
echo "  • Zero compilation wait — runs instantly"
echo ""
echo "Saved: ~1.8MB download + 2-5 seconds load time"
echo ""
echo "Next steps:"
echo "  git add dist/app.html dist/vercel.json dist/sw.js"
echo "  git commit -m 'Build: pre-compile JSX, remove Babel Standalone'"
echo "  git push"
echo ""
