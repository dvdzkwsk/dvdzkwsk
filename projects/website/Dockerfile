# Built and deployed by `pnpm run deploy` (tools/Build.ts), which first writes:
#   dist/website   the built frontend
#   dist/server.js Server.ts bundled with all of its dependencies
# so the image needs nothing but Bun.
FROM oven/bun:1-slim

WORKDIR /app
COPY dist/website ./website
COPY dist/server.js ./server.js

ENV NODE_ENV=production

CMD ["bun", "server.js"]
