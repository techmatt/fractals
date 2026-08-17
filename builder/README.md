# builder

The page generator. Not written yet — this directory is homed so the first line of it
lands somewhere already decided.

What it will do: read the release and curation records from the code repository
(`C:\Code\fractal-wallpapers`), write gallery pages into `../galleries/` and figure
markup into the article pages, and produce web-res derivatives of the images it
references into `../assets/images/`.

Two things are settled about it in advance:

- **Its output is committed HTML.** The site never depends on the builder having run,
  and GitHub Pages never runs Python. A build is something done here and reviewed in
  a diff.
- **It only ever reads the code repository.** Nothing in `fractal-wallpapers` is
  written, moved, or regenerated from this side.

Python is governed by the `ruff` config in `../pyproject.toml`: line length 100,
`pathlib` only, no absolute paths in tracked code.
