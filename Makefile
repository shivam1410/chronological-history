.PHONY: build validate test test-py test-js serve stats setup clean

# Prefer the project venv when present, else fall back to python3.
PY := $(shell [ -x .venv/bin/python ] && echo .venv/bin/python || echo python3)

setup:  ## create .venv and install dependencies
	python3 -m venv .venv
	.venv/bin/pip install --upgrade pip
	.venv/bin/pip install -r requirements.txt

build:  ## regenerate site/data from data/ sources
	$(PY) -m pipeline.cli build

validate:  ## validate sources without emitting
	$(PY) -m pipeline.cli validate

stats:  ## coverage report over the built dataset
	$(PY) -m pipeline.cli stats

test: test-py test-js  ## run both suites

test-py:
	@$(PY) -m pytest; rc=$$?; \
	if [ $$rc -eq 5 ]; then echo "no python tests yet"; exit 0; else exit $$rc; fi

test-js:
	@if ls site/js/*.test.js >/dev/null 2>&1; then node --test site/js/; \
	else echo "no js tests yet"; fi

serve:  ## preview at http://localhost:8000
	@echo "serving site/ at http://localhost:8000"
	@cd site && $(PY) -m http.server 8000

clean:
	rm -rf site/data/eras site/data/*.json .pytest_cache
	find . -name __pycache__ -type d -exec rm -rf {} +
