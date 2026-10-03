.PHONY: test corpus fixture matrix page gate all clean

PY ?= python3

all: test fixture matrix page

test:
	$(PY) test/run_tests.py

corpus:
	$(PY) -c "import json,sys;d=json.load(open('corpus/probes.json'));print(len(d['probes']),'probes,',d['status'])"

# Synthetic run. Proves the pipeline, measures nothing. k=30 is the point where
# samples outnumber features and the battery stops being underdetermined.
fixture:
	$(PY) scripts/run_battery.py --offline --k 30 --out runs/fixture.jsonl

# Same, with two families collapsed onto one behaviour, to check the matrix
# reports BLIND instead of inventing a separation.
fixture-collide:
	$(PY) scripts/run_battery.py --offline --k 30 --collide llama-class,mistral-class --out runs/fixture-collide.jsonl
	$(PY) scripts/build_matrix.py runs/fixture-collide.jsonl --out /tmp/matrix-collide.json

matrix:
	$(PY) scripts/build_matrix.py runs/fixture.jsonl --out web/matrix.json

page:
	$(PY) scripts/build_page.py

gate:
	$(PY) scripts/check_matrix.py web/matrix.json

clean:
	rm -f web/index.html web/matrix.json runs/*.jsonl
