
SCHEMES_BASE16 = $(wildcard base16/*.less)
SCHEMES = $(SCHEMES_BASE16:base16/%.less=schemes/%.css)

build: $(SCHEMES) style.css

schemes/%.css: scheme.less
	mkdir -p schemes
	lessc --global-var='name=$*' $^ > $@

%.css: %.less
	lessc $^ > $@

clean:
	rm -fv schemes/*.css style.css
