FROM node:22-bookworm-slim

# Claude Code version. Check your CPU first (docs/architecture.md, step 1): current releases are a native binary
# that may crash on CPUs without AVX, such as some NAS Atom chips. 2.1.112 is the last plain JS release.
ARG CLAUDE_CODE_VERSION=latest

# python3 and pypdf: ai-job-search's tools/*.py and /apply's ATS check need them.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git curl unzip ca-certificates openssh-client tzdata python3 python3-pip jq \
    && pip3 install --break-system-packages --no-cache-dir pypdf \
    && rm -rf /var/lib/apt/lists/*

# ai-job-search compiles CVs with lualatex (moderncv) and cover letters with xelatex (fontspec).
# texlive-fonts-extra carries fontawesome5 and academicons, which moderncv loads.
# fonts-noto-cjk lets Hong Kong documents include Chinese names or text.
RUN apt-get update && apt-get install -y --no-install-recommends \
      texlive-luatex texlive-xetex texlive-latex-extra texlive-fonts-recommended texlive-fonts-extra \
      lmodern fonts-noto-cjk poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Bun baseline build: some NAS CPUs have no AVX2,
# so the standard bun binary can fail with "Illegal instruction".
RUN curl -fsSL https://github.com/oven-sh/bun/releases/latest/download/bun-linux-x64-baseline.zip -o /tmp/bun.zip \
    && unzip -q /tmp/bun.zip -d /tmp \
    && mv /tmp/bun-linux-x64-baseline/bun /usr/local/bin/bun \
    && chmod +x /usr/local/bin/bun \
    && rm -rf /tmp/bun*

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}"

# Run as the non-root "node" user (uid 1000).
USER node
ENV HOME=/home/node \
    PATH=/home/node/.bun/bin:$PATH \
    TZ=UTC \
    DISABLE_AUTOUPDATER=1
WORKDIR /repos

CMD ["sleep", "infinity"]
