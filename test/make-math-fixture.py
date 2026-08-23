#!/usr/bin/env python3
"""
Dev-only tool. Generates test/math-fixture.docx: a Word document containing
native Word equations (OMML) covering the constructs that stress a PDF
renderer's math support.

Used to verify that `soffice --convert-to pdf` preserves formulas.
Run:  python3 test/make-math-fixture.py
"""
import zipfile, os

NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
)

MATH_RPR = ('<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math" '
            'w:cs="Cambria Math"/><w:i/></w:rPr>')


def mr(text, italic=True):
    """A math run."""
    rpr = MATH_RPR if italic else (
        '<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>')
    return f'<m:r>{rpr}<m:t xml:space="preserve">{text}</m:t></m:r>'


def frac(num, den):
    return f'<m:f><m:fPr><m:ctrlPr>{MATH_RPR}</m:ctrlPr></m:fPr>' \
           f'<m:num>{num}</m:num><m:den>{den}</m:den></m:f>'


def rad(e, deg=''):
    hide = '<m:degHide m:val="1"/>' if not deg else ''
    return f'<m:rad><m:radPr>{hide}<m:ctrlPr>{MATH_RPR}</m:ctrlPr></m:radPr>' \
           f'<m:deg>{deg}</m:deg><m:e>{e}</m:e></m:rad>'


def sup(base, exp):
    return f'<m:sSup><m:sSupPr><m:ctrlPr>{MATH_RPR}</m:ctrlPr></m:sSupPr>' \
           f'<m:e>{base}</m:e><m:sup>{exp}</m:sup></m:sSup>'


def sub(base, s):
    return f'<m:sSub><m:sSubPr><m:ctrlPr>{MATH_RPR}</m:ctrlPr></m:sSubPr>' \
           f'<m:e>{base}</m:e><m:sub>{s}</m:sub></m:sSub>'


def nary(chr_, sb, sp, e, limloc="subSup"):
    return f'<m:nary><m:naryPr><m:chr m:val="{chr_}"/><m:limLoc m:val="{limloc}"/>' \
           f'<m:ctrlPr>{MATH_RPR}</m:ctrlPr></m:naryPr>' \
           f'<m:sub>{sb}</m:sub><m:sup>{sp}</m:sup><m:e>{e}</m:e></m:nary>'


def delim(inner, beg="(", end=")"):
    return f'<m:d><m:dPr><m:begChr m:val="{beg}"/><m:endChr m:val="{end}"/>' \
           f'<m:ctrlPr>{MATH_RPR}</m:ctrlPr></m:dPr><m:e>{inner}</m:e></m:d>'


def matrix(rows):
    cols = len(rows[0])
    mcs = (f'<m:mcs><m:mc><m:mcPr><m:count m:val="{cols}"/>'
           f'<m:mcJc m:val="center"/></m:mcPr></m:mc></m:mcs>')
    body = ''.join(
        '<m:mr>' + ''.join(f'<m:e>{c}</m:e>' for c in row) + '</m:mr>'
        for row in rows)
    return f'<m:m><m:mPr>{mcs}<m:ctrlPr>{MATH_RPR}</m:ctrlPr></m:mPr>{body}</m:m>'


def display(content):
    """Display (block) equation on its own line."""
    return f'<w:p><m:oMathPara><m:oMath>{content}</m:oMath></m:oMathPara></w:p>'


def para(text, bold=False, size=None):
    rpr = '<w:rPr>'
    if bold:
        rpr += '<w:b/>'
    if size:
        rpr += f'<w:sz w:val="{size}"/>'
    rpr += '</w:rPr>'
    return f'<w:p>{rpr and ""}<w:r>{rpr}<w:t xml:space="preserve">{text}</w:t></w:r></w:p>'


def inline_para(before, math, after):
    """Text with an inline equation in the middle."""
    return (f'<w:p><w:r><w:t xml:space="preserve">{before}</w:t></w:r>'
            f'<m:oMath>{math}</m:oMath>'
            f'<w:r><w:t xml:space="preserve">{after}</w:t></w:r></w:p>')


# ---- the equations -------------------------------------------------------

# 1. Quadratic formula: fraction + radical + superscript + plus-minus
quadratic = (
    mr('x') + mr('=', italic=False) +
    frac(
        mr('&#8722;') + mr('b') + mr('&#177;', italic=False) +
        rad(sup(mr('b'), mr('2')) + mr('&#8722;', italic=False) +
            mr('4') + mr('a') + mr('c')),
        mr('2') + mr('a')))

# 2. Gaussian integral: n-ary operator with limits
integral = (
    nary('&#8747;', mr('0'), mr('&#8734;'),
         sup(mr('e'), mr('&#8722;') + sup(mr('x'), mr('2')))
         + mr('d') + mr('x')) +
    mr('=', italic=False) +
    frac(rad(mr('&#960;')), mr('2')))

# 3. Basel problem: summation with over/under limits
summation = (
    nary('&#8721;', mr('n') + mr('=', italic=False) + mr('1'), mr('&#8734;'),
         frac(mr('1'), sup(mr('n'), mr('2'))), limloc="undOvr") +
    mr('=', italic=False) +
    frac(sup(mr('&#960;'), mr('2')), mr('6')))

# 4. Matrix in brackets
mat = (
    mr('A') + mr('=', italic=False) +
    delim(matrix([[mr('a'), mr('b')], [mr('c'), mr('d')]]), '[', ']'))

# 5. Inline equation inside running text
inline_eq = sup(mr('a'), mr('2')) + mr('+', italic=False) + \
    sup(mr('b'), mr('2')) + mr('=', italic=False) + sup(mr('c'), mr('2'))

# 6. Font-coverage torture test: Greek + operators.
#    If the container lacks math fonts, THIS is where tofu boxes appear.
glyphs = (
    mr('&#945;') + mr('&#946;') + mr('&#947;') + mr('&#948;') +
    mr('&#8706;') + mr('&#8711;') + mr('&#8721;') + mr('&#8730;') +
    mr('&#8734;') + mr('&#8804;') + mr('&#8805;') + mr('&#8800;') +
    mr('&#8712;') + mr('&#8704;') + mr('&#8707;') + mr('&#8834;') +
    mr('&#8594;') + mr('&#8658;') + mr('&#8801;') + mr('&#8776;'))

body = (
    para('Math rendering fixture', bold=True, size='32') +
    para('Every formula below is a native Word equation (OMML).') +
    para('') +
    para('1. Quadratic formula (fraction, radical, superscript):', bold=True) +
    display(quadratic) +
    para('2. Gaussian integral (n-ary operator, sub/sup limits):', bold=True) +
    display(integral) +
    para('3. Basel problem (summation, under/over limits):', bold=True) +
    display(summation) +
    para('4. Matrix (delimiters, grid):', bold=True) +
    display(mat) +
    para('5. Inline equation inside a sentence:', bold=True) +
    inline_para('The Pythagorean theorem states that ', inline_eq,
                ' for any right triangle.') +
    para('6. Glyph coverage (tofu boxes here = missing math font):',
         bold=True) +
    display(glyphs))

DOCUMENT = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' \
           f'<w:document {NS}><w:body>{body}' \
           f'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' \
           f'<w:pgMar w:top="1134" w:bottom="1134" w:left="1134" w:right="1134"/>' \
           f'</w:sectPr></w:body></w:document>'

CONTENT_TYPES = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>'''

RELS = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'math-fixture.docx')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', CONTENT_TYPES)
    z.writestr('_rels/.rels', RELS)
    z.writestr('word/document.xml', DOCUMENT)

print(f'wrote {out} ({os.path.getsize(out)} bytes)')
