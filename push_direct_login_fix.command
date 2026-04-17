#!/bin/bash
cd "$(dirname "$0")"

export GIT_TERMINAL_PROMPT=0
REPO_URL="https://x-access-token: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@github.com/bbadauk/creative-kaygency.git"

git remote set-url origin "$REPO_URL" 2>/dev/null

echo "📦 Staging direct login fix..."
git add index.html dist/app.html
git commit -m "Fix login: bypass stale AuthContext, call Supabase directly

- LoginPage now calls supabaseClient.auth.signInWithPassword() directly
- Removes dependency on useContext(AuthContext) which had stale closures
- Local state for isLoading, loginError, loginSuccess, oauthError
- OAuth buttons use shared handleOAuth with local error state
- Inline error/success banners render immediately on state change
- Fixes issue where login form appeared to do nothing

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

echo "🚀 Pushing to GitHub..."
git push origin main

echo ""
echo "✅ Direct login fix deployed! Vercel will auto-deploy in ~30 seconds."
echo ""
read -p "Press Enter to close..."
