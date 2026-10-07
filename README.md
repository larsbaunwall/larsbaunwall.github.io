# Lars Baunwall, curriculum vitae

This is the source of my CV site: **https://larsbaunwall.github.io/**

It is a small, quiet, typography-led page with my experience, projects, education and skills. You can also download it as a PDF, either the [full CV](https://larsbaunwall.github.io/lars-baunwall-cv.pdf) or a [one-page summary](https://larsbaunwall.github.io/lars-baunwall-cv-onepage.pdf).

## How it works

The content is not written by hand. It is pulled from my LinkedIn profile with [unlinked](https://www.npmjs.com/package/@larsbaunwall/unlinked), tidied up by a small script, and turned into a static site with [Hugo](https://gohugo.io/). The PDFs are generated from the same data. A GitHub Action rebuilds and publishes everything to GitHub Pages whenever I push, and again every night, so the site follows my profile.

The site has no JavaScript, no tracking and no external requests. Fonts (Source Serif 4 and Inter) are served from the site itself.

## Want to build your own?

You are welcome to borrow the ideas. The setup, scripts, data pipeline and deployment details are in [AGENTS.md](AGENTS.md). You will need your own LinkedIn Member Data Portability token (available to members in the EEA and Switzerland) and your own content, since the text and portrait here are mine.
