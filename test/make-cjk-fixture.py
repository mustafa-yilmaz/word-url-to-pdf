#!/usr/bin/env python3
"""
Dev-only tool. Generates test/cjk-fixture.docx: a Word document containing
Chinese text in the typefaces Word actually writes into .docx files.

Used to verify that `soffice --convert-to pdf` renders CJK rather than
substituting a Latin font with no Chinese glyphs.

Run:  python3 test/make-cjk-fixture.py
"""
import zipfile, os

NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')


def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def para(text, east_asia=None, ascii_font=None, bold=False, size=None, lang=None):
    """A paragraph.

    `east_asia` is the w:eastAsia font Word records for CJK runs, and `lang`
    is the w:eastAsia language tag Word writes alongside it. Real Word
    documents almost always carry that language tag, and font matching uses
    it to choose a regional glyph set, so the fixture sets it too.
    """
    rfonts = ''
    if east_asia or ascii_font:
        parts = []
        if ascii_font:
            parts.append(f'w:ascii="{ascii_font}" w:hAnsi="{ascii_font}"')
        if east_asia:
            parts.append(f'w:eastAsia="{east_asia}"')
        rfonts = f'<w:rFonts {" ".join(parts)}/>'
    lang_el = f'<w:lang w:eastAsia="{lang}"/>' if lang else ''
    rpr = '<w:rPr>' + rfonts + ('<w:b/>' if bold else '') + \
          (f'<w:sz w:val="{size}"/>' if size else '') + lang_el + '</w:rPr>'
    return f'<w:p><w:r>{rpr}<w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>'


# Each block names the Word font in its own text, so a rendered PDF shows
# which typeface was requested next to what was actually drawn.
blocks = [
    para('Chinese rendering fixture', bold=True, size='32'),
    para('Each line below requests a different Word CJK font.'),
    para(''),

    para('1. SimSun / 宋体 (default Word serif):', bold=True),
    para('中文测试：这是一段用宋体排版的简体中文文字。', east_asia='SimSun', lang='zh-CN'),

    para('2. SimHei / 黑体 (sans-serif):', bold=True),
    para('中文测试：这是一段用黑体排版的简体中文文字。', east_asia='SimHei', lang='zh-CN'),

    para('3. Microsoft YaHei / 微软雅黑 (modern UI sans):', bold=True),
    para('中文测试：这是一段用微软雅黑排版的简体中文文字。', east_asia='Microsoft YaHei', lang='zh-CN'),

    para('4. KaiTi / 楷体 (brush/kai style):', bold=True),
    para('中文测试：这是一段用楷体排版的简体中文文字。', east_asia='KaiTi', lang='zh-CN'),

    para('5. FangSong / 仿宋 (official documents):', bold=True),
    para('中文测试：这是一段用仿宋排版的简体中文文字。', east_asia='FangSong', lang='zh-CN'),

    para('6. Traditional Chinese (繁體中文):', bold=True),
    para('繁體中文測試：這是一段繁體中文文字，用於檢查字型覆蓋範圍。', east_asia='PMingLiU', lang='zh-TW'),

    para('7. Mixed Chinese and Latin in one run:', bold=True),
    para('The document 文件 was converted 转换 to PDF 格式 successfully 成功。',
         east_asia='SimSun', ascii_font='Times New Roman', lang='zh-CN'),

    para('8. CJK punctuation and full-width forms:', bold=True),
    para('，。、；：？！「」『』《》（）【】—…　１２３ＡＢＣ', east_asia='SimSun', lang='zh-CN'),

    para('9. Numbers, dates and units in Chinese context:', bold=True),
    para('二〇二六年八月二十三日，共计 1,234 元，占 56.7% 。', east_asia='SimSun', lang='zh-CN'),

    para('10. Rare/extended characters (coverage edge cases):', bold=True),
    para('龘齉齾爩鱻麤，𠀋𡃁 （扩展区汉字）', east_asia='SimSun', lang='zh-CN'),
]

body = ''.join(blocks)

DOCUMENT = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<w:document {NS}><w:body>{body}'
            f'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            f'<w:pgMar w:top="1134" w:bottom="1134" w:left="1134" w:right="1134"/>'
            f'</w:sectPr></w:body></w:document>')

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

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cjk-fixture.docx')
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', CONTENT_TYPES)
    z.writestr('_rels/.rels', RELS)
    z.writestr('word/document.xml', DOCUMENT)

print(f'wrote {out} ({os.path.getsize(out)} bytes)')
