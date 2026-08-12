# -*- coding: utf-8 -*-
"""
build_index.py — Constrói o corpus para o website de Perguntas & Respostas.

Extrai o texto do PDF "REG HABITAÇÃO PUBLICAÇÃO EM DR II - 29 JAN 24.pdf"
(publicação oficial em Diário da República, 2.ª série, n.º 20, de 29/01/2024)
que contém o texto integral do Regulamento Geral de Habitação do Município
de Sintra — o mesmo regulamento constante do documento "Regulamento Habitação
A.M.S.pdf", cuja camada de texto está bloqueada (anti-cópia) e não é extraível.

O texto é limpo, segmentado por artigo/secção e serializado em "data.js"
para ser usado (100% offline) pelo frontend estático.
"""

import glob
import json
import os
import re
import unicodedata
from datetime import datetime

try:
    import pymupdf
except ImportError:  # pragma: no cover
    import fitz as pymupdf

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_FILE = os.path.join(BASE_DIR, "data.js")

SOURCE_DR = {
    "name": (
        "Diário da República, 2.ª série, n.º 20, de 29 de janeiro de 2024 "
        "(Aviso n.º 2346/2024) — Regulamento Geral de Habitação do Município de Sintra"
    ),
    "file": "REG HABITAÇÂO PUBLICAÇÃO EM DR II - 29 JAN 24.pdf",
}

SOURCE_AMS = {
    "name": (
        "Regulamento Habitação A.M.S — Regulamento Geral de Habitação do Município "
        "de Sintra (documento pré-publicação; texto bloqueado, corresponde à "
        "publicação em DR II)"
    ),
    "file": "Regulamento Habitação A.M.S.pdf",
}

# Cabeçalhos/rodapés de página do Diário da República que devem ser removidos.
PAGE_HEADERS = {
    "N.º 20",
    "29 de janeiro de 2024",
    "Diário da República, 2.ª série",
    "PARTE H",
}

RE_PAGE_NO = re.compile(r"^Pág\.\s*\d+$")
RE_TITULO = re.compile(r"^TÍTULO\s+[IVXLCDM]+$")
RE_CAPITULO = re.compile(r"^CAPÍTULO\s+[IVXLCDM]+$")
RE_SECCAO = re.compile(r"^SECÇÃO\s+[IVXLCDM]+$")
RE_ARTIGO = re.compile(r"^Artigo\s+(\d+)\.[º°]?\s*$")


def find_pdf():
    for path in glob.glob(os.path.join(BASE_DIR, "*.pdf")):
        if "DR II" in os.path.basename(path) or "PUBLICAÇÃO" in os.path.basename(path) or "PUBLICACAO" in os.path.basename(path):
            return path
    pdfs = sorted(glob.glob(os.path.join(BASE_DIR, "*.pdf")))
    return pdfs[0] if pdfs else None


def extract_text(path):
    doc = pymupdf.open(path)
    try:
        return "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()


def clean_lines(full_text):
    """Remove cabeçalhos de página e resolve hifenizações de fim de linha."""
    lines = []
    for raw in full_text.split("\n"):
        s = raw.strip()
        if not s:
            lines.append("")
            continue
        if s in PAGE_HEADERS:
            continue
        if RE_PAGE_NO.match(s):
            continue
        lines.append(s)

    merged = []
    i = 0
    n = len(lines)
    while i < n:
        ln = lines[i]
        nxt = lines[i + 1] if i + 1 < n else ""
        if ln.endswith("-") and nxt and nxt[0].islower():
            had_space = ln.endswith(" -")
            core = ln.rstrip("-").rstrip()
            if had_space:
                merged.append(core + "-" + nxt.strip())
            else:
                merged.append(core + nxt.strip())
            i += 2
        else:
            merged.append(ln)
            i += 1
    return merged


def fix_inline_hyphens(text):
    """Corrige hifenizações não resolvidas.

    - 'Decreto -Lei' -> 'Decreto-Lei', 'incumbindo -lhe' -> 'incumbindo-lhe'
    - 'candi- dato' -> 'candidato' (quebra de linha/coluna perdeu a junção)
    """
    text = re.sub(r"\s-(?=\S)", "-", text)
    text = re.sub(r"(?<=[a-z\u00c0-\u00ff])-\s+(?=[a-z\u00c0-\u00ff])", "", text)
    return text


def is_heading(line):
    return any(
        r.match(line)
        for r in (RE_TITULO, RE_CAPITULO, RE_SECCAO)
    ) or line == "ANEXO ÚNICO" or line == "Nota justificativa"


def segment(lines):
    """Transforma as linhas limpas em chunks estruturados."""
    chunks = []
    ctx = {"titulo": "", "capitulo": "", "secao": ""}
    pending = None
    expect_name = None  # "titulo" | "capitulo" | "secao" | "anexo" | "artigo"

    def path_of(ctx):
        parts = [p for p in (ctx["titulo"], ctx["capitulo"], ctx["secao"]) if p]
        return " · ".join(parts)

    def flush():
        nonlocal pending
        if pending:
            pending["text"] = fix_inline_hyphens(pending["text"]).strip()
            if pending["text"]:
                chunks.append(pending)
            pending = None

    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        if expect_name:
            name = s
            if expect_name == "titulo":
                ctx["titulo"] = "TÍTULO — " + name
                ctx["capitulo"] = ""
                ctx["secao"] = ""
            elif expect_name == "capitulo":
                ctx["capitulo"] = "CAPÍTULO — " + name
                ctx["secao"] = ""
            elif expect_name == "secao":
                ctx["secao"] = "SECÇÃO — " + name
            elif expect_name == "anexo":
                pending["title"] = "ANEXO ÚNICO — " + name
            elif expect_name == "artigo":
                num = pending["num"]
                pending["title"] = "Artigo %d.º — %s" % (num, name)
            expect_name = None
            continue

        if RE_TITULO.match(s):
            flush()
            ctx["titulo"] = s
            ctx["capitulo"] = ""
            ctx["secao"] = ""
            expect_name = "titulo"
            continue
        if RE_CAPITULO.match(s):
            flush()
            ctx["capitulo"] = s
            ctx["secao"] = ""
            expect_name = "capitulo"
            continue
        if RE_SECCAO.match(s):
            flush()
            ctx["secao"] = s
            expect_name = "secao"
            continue
        if s == "ANEXO ÚNICO":
            flush()
            pending = {"kind": "anexo", "num": None, "title": "ANEXO ÚNICO",
                       "path": "", "src": 0, "text": ""}
            expect_name = "anexo"
            continue
        if s == "Nota justificativa":
            flush()
            pending = {"kind": "preambulo", "num": None,
                       "title": "Nota justificativa", "path": "", "src": 0,
                       "text": ""}
            continue

        m = RE_ARTIGO.match(s)
        if m:
            flush()
            pending = {"kind": "artigo", "num": int(m.group(1)),
                       "title": s, "path": path_of(ctx), "src": 0, "text": ""}
            expect_name = "artigo"
            continue

        if pending is None:
            pending = {"kind": "aviso", "num": None,
                       "title": "Aviso n.º 2346/2024 (publicação)",
                       "path": "", "src": 0, "text": ""}
        pending["text"] += (" " if pending["text"] else "") + fix_inline_hyphens(s)

    flush()
    return chunks


STOPWORDS = set("""
a o e é de da do das dos em na no nas nos ao aos à às por para com sem sob
sobre entre até desde após antes depois como qual quais quem que cujo cuja
cujos cujas onde quando quanto quantos quantas porque porquê se ou mas porém
contudo não sim já ainda também mais menos muito muita muitos muitas pouco
pouca poucos poucas todo toda todos todas este esta estes estas esse essa
esses essas aquele aquela aqueles aquelas isto isso aquilo eu tu ele ela nós
vós eles elas me te lhe lhes ser estar ter haver fazer poder dever querer
dizer ir vir ficar olá oi bom boa bons boas dia tarde noite manhã obrigado
obrigada adeus favor talvez aqui ali lá tudo nada algo alguém ninguém outro
outra outros outras meu minha meus minhas teu tua teus tuas seu sua seus suas
nosso nossa nossos nossas vosso vossa vossos vossas dele dela deles delas
pode podem podia poderia deveria deve devem tenha tenham havia forma fim
caso termos termos pra pois então depois assim bem mal qual quais apenas
""".split())


def remove_accents(t):
    return "".join(
        c for c in unicodedata.normalize("NFD", t) if unicodedata.category(c) != "Mn"
    )


def stem(w):
    """Radicalização ligeira do português (plurais comuns)."""
    if len(w) <= 4:
        return w
    if w.endswith("ções") and len(w) >= 7:
        return w[:-4] + "ção"
    if w.endswith("sões") and len(w) >= 6:
        return w[:-4] + "são"
    if w.endswith("ães") and len(w) >= 5:
        return w[:-3] + "ão"
    if w.endswith("ões") and len(w) >= 5:
        return w[:-3] + "ão"
    if w.endswith("ais") and len(w) >= 5:
        return w[:-2] + "al"
    if w.endswith("eis") and len(w) >= 5:
        return w[:-2] + "el"
    if w.endswith("os") and len(w) >= 5 and w[-3] in "aeiouáéíóú":
        return w[:-1]
    if w.endswith("as") and len(w) >= 5 and w[-3] in "aeiouáéíóú":
        return w[:-1]
    if w.endswith("es") and len(w) >= 5 and w[-3] in "aeiouáéíóú":
        return w[:-2] + "e"
    if w.endswith("s") and len(w) >= 5 and w[-2] in "aeiouáéíóúãõ":
        return w[:-1]
    return w


def tokenize(text):
    norm = remove_accents(text.lower())
    words = re.findall(r"[a-z0-9]+", norm)
    return [stem(w) for w in words if w not in STOPWORDS and len(w) > 1]


def build():
    pdf = find_pdf()
    if not pdf:
        raise SystemExit("PDF não encontrado na pasta.")
    full = extract_text(pdf)
    lines = clean_lines(full)
    chunks = segment(lines)

    data = {
        "builtAt": datetime.now().isoformat(timespec="seconds"),
        "sources": [SOURCE_DR, SOURCE_AMS],
        "note": (
            "O 'Regulamento Habitação A.M.S.pdf' corresponde ao mesmo regulamento "
            "(Regulamento Geral de Habitação do Município de Sintra) cuja camada de "
            "texto está bloqueada; o corpus é extraído da sua publicação oficial "
            "em Diário da República, 2.ª série, n.º 20, de 29 de janeiro de 2024."
        ),
        "chunks": chunks,
    }

    js = "/* Gerado por build_index.py — não editar. */\n"
    js += "window.CMS_HABITACAO = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n"
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        f.write(js)

    print("PDF usado:", os.path.basename(pdf))
    print("Chunks:", len(chunks))
    print("Artigos:", sum(1 for c in chunks if c["kind"] == "artigo"))
    print("Caracteres de texto:", sum(len(c["text"]) for c in chunks))
    print("Tokens totais:", sum(len(tokenize(c["text"])) for c in chunks))
    print("Ficheiro de saída:", OUT_FILE)
    print("Tamanho (KB):", round(os.path.getsize(OUT_FILE) / 1024, 1))


if __name__ == "__main__":
    build()
