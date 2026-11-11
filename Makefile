# Wippit! — static web game. No bundler, no server-side code.
#
#   make build   generate icons, version.js and sw.js (needs only python3)
#   make run     build, then serve the directory on http://localhost:$(PORT)/
#   make check   fail if the generated files are out of date (used in CI)
#   make clean   remove generated files

PORT ?= 8000
PYTHON ?= python3

.PHONY: build run check clean

build:
	$(PYTHON) tools/build.py

check:
	$(PYTHON) tools/build.py --check

run: build
	@echo "Serving Wippit! at http://localhost:$(PORT)/  (Ctrl+C to stop)"
	$(PYTHON) -m http.server $(PORT) --bind 127.0.0.1

clean:
	rm -f sw.js version.js icons/icon-192.png icons/icon-512.png icons/maskable-512.png icons/apple-touch-icon.png
