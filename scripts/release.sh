#!/usr/bin/env bash
set -euo pipefail

npm test
npm version patch
git push origin main --tags
gh release create "v$(node -p "require('./package.json').version")" --generate-notes
read -p "npm OTP: " otp
npm publish --otp="$otp"
