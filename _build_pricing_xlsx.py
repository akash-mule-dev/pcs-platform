"""Generate PCS-Pricing-Model.xlsx — a live, formula-driven pricing & ARR model.
Edit the blue cells on the Assumptions sheet; ARR Model and Unit Economics recompute.
"""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

# ---- styles -------------------------------------------------------------
TITLE   = Font(bold=True, size=14, color="1F4E78")
HEAD    = Font(bold=True, color="FFFFFF")
SECTION = Font(bold=True, size=11, color="1F4E78")
BOLD    = Font(bold=True)
HEAD_FILL  = PatternFill("solid", fgColor="1F4E78")
INPUT_FILL = PatternFill("solid", fgColor="DDEBF7")   # blue = editable
CALC_FILL  = PatternFill("solid", fgColor="F2F2F2")   # grey = computed
thin = Side(style="thin", color="BFBFBF")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)

USD  = '#,##0'
USD0 = '$#,##0'
PCT  = '0.0%'
NUM  = '0'
MON  = '0.0" mo"'
RAT  = '0.0"x"'

wb = Workbook()

def cell(ws, ref, value, *, font=None, fill=None, fmt=None, align=None, border=False):
    c = ws[ref]
    c.value = value
    if font: c.font = font
    if fill: c.fill = fill
    if fmt:  c.number_format = fmt
    if align: c.alignment = Alignment(horizontal=align)
    if border: c.border = BORDER
    return c

# =========================================================================
# README
# =========================================================================
ws = wb.active
ws.title = "README"
ws.sheet_view.showGridLines = False
cell(ws, "A1", "PCS Platform — Pricing & ARR Model", font=TITLE)
notes = [
    "",
    "HOW TO USE",
    "  • Edit only the BLUE cells on the 'Assumptions' tab. Everything else is a formula.",
    "  • 'ARR Model' rolls each segment's bookings forward by NRR and sums Low/Base/High scenarios.",
    "  • 'Unit Economics' derives gross margin, CAC payback and LTV:CAC, with CAD-conversion compute broken out as COGS.",
    "",
    "MODEL LOGIC",
    "  • Metric = price per production SITE; floor/operator access is unlimited, only office/admin seats are counted.",
    "  • Ending ARR(t) = Ending ARR(t-1) × NRR + new-logo ARR(t), tracked per segment then summed.",
    "  • Scenarios scale the Base new-logo plan by the multipliers (Low 0.6× / Base 1.0× / High 1.5×).",
    "  • LTV = annual gross profit ÷ logo churn (no expansion credit — conservative).",
    "  • Net CAC = CAC − onboarding gross profit (onboarding fees substantially offset acquisition cost).",
    "",
    "CAVEATS",
    "  • Figures are planning anchors, NOT committed list prices. Validate willingness-to-pay first.",
    "  • LTV:CAC ratios are gated by the churn assumptions — stress-test churn before trusting them.",
    "  • See PRICING.md for the narrative one-pager this model backs.",
]
for i, t in enumerate(notes, start=2):
    f = SECTION if t in ("HOW TO USE", "MODEL LOGIC", "CAVEATS") else None
    cell(ws, f"A{i}", t, font=f)
ws.column_dimensions["A"].width = 110

# =========================================================================
# ASSUMPTIONS
# =========================================================================
a = wb.create_sheet("Assumptions")
a.sheet_view.showGridLines = False
cell(a, "A1", "Model Assumptions — edit the blue cells", font=TITLE)

def label(r, text):    cell(a, f"A{r}", text)
def section(r, text):  cell(a, f"A{r}", text, font=SECTION)
def inp(ref, v, fmt=USD): cell(a, ref, v, fill=INPUT_FILL, fmt=fmt, border=True, align="right")

section(3, "PRICING (per site / year)")
label(4, "Core MES");            inp("B4", 12000)
label(5, "Quality & Traceability"); inp("B5", 30000)
label(6, "Digital Twin / AR");   inp("B6", 54000)
label(7, "Office/admin seat / yr"); inp("B7", 720)

section(9, "SEGMENT ECONOMICS")
label(10, "SMB blended ACV");        inp("B10", 22000)
label(11, "Mid-market blended ACV"); inp("B11", 150000)
label(12, "SMB onboarding (one-time)"); inp("B12", 7500)
label(13, "Mid onboarding (one-time)"); inp("B13", 20000)

section(15, "RETENTION")
label(16, "SMB net revenue retention (NRR)"); inp("B16", 1.00, PCT)
label(17, "Mid NRR");                          inp("B17", 1.15, PCT)
label(18, "SMB logo churn / yr");              inp("B18", 0.15, PCT)
label(19, "Mid logo churn / yr");              inp("B19", 0.08, PCT)

section(21, "NEW-LOGO PLAN (Base scenario)")
cell(a, "B22", "Y1", font=BOLD, align="right"); cell(a, "C22", "Y2", font=BOLD, align="right"); cell(a, "D22", "Y3", font=BOLD, align="right")
label(23, "SMB new logos"); inp("B23", 12, NUM); inp("C23", 25, NUM); inp("D23", 40, NUM)
label(24, "Mid new logos"); inp("B24", 2, NUM);  inp("C24", 5, NUM);  inp("D24", 9, NUM)

section(26, "SCENARIO MULTIPLIERS")
cell(a, "B27", "Low", font=BOLD, align="right"); cell(a, "C27", "Base", font=BOLD, align="right"); cell(a, "D27", "High", font=BOLD, align="right")
label(28, "× Base plan"); inp("B28", 0.6, '0.0"x"'); inp("C28", 1.0, '0.0"x"'); inp("D28", 1.5, '0.0"x"')

section(30, "UNIT ECONOMICS INPUTS")
label(31, "SMB CAC per logo"); inp("B31", 8000)
label(32, "Mid CAC per logo"); inp("B32", 45000)
label(33, "Onboarding gross margin %"); inp("B33", 0.40, PCT)

section(35, "COGS per SITE / year")
label(36, "Hosting & infra");            inp("B36", 1200)
label(37, "CAD-conversion compute");     inp("B37", 1500)
label(38, "Support / CS");               inp("B38", 2000)
label(39, "Payment processing (% of ACV)"); inp("B39", 0.025, PCT)

section(41, "SITES PER CUSTOMER")
label(42, "SMB sites"); inp("B42", 1, NUM)
label(43, "Mid sites"); inp("B43", 4, NUM)

a.column_dimensions["A"].width = 34
for col in ("B", "C", "D"): a.column_dimensions[col].width = 13

# =========================================================================
# ARR MODEL
# =========================================================================
m = wb.create_sheet("ARR Model")
m.sheet_view.showGridLines = False
cell(m, "A1", "ARR Model — ending ARR by scenario", font=TITLE)

def hdr_yrs(r):
    cell(m, f"A{r}", "", font=BOLD)
    for col, y in (("B","Y1"),("C","Y2"),("D","Y3")):
        cell(m, f"{col}{r}", y, font=HEAD, fill=HEAD_FILL, align="right")

# --- summary ---
cell(m, "A3", "ENDING ARR BY SCENARIO ($)", font=SECTION)
hdr_yrs(4)
for r, name, src in ((5,"Low",20),(6,"Base",32),(7,"High",44)):
    cell(m, f"A{r}", name, font=BOLD)
    for col in ("B","C","D"):
        cell(m, f"{col}{r}", f"={col}{src}", fmt=USD0, fill=CALC_FILL, border=True)
cell(m, "A9", "Services revenue (one-time, Base)", font=BOLD)
for col in ("B","C","D"):
    cell(m, f"{col}9", f"={col}33", fmt=USD0, fill=CALC_FILL, border=True)

# --- scenario blocks: (title_row, mult_cell) ---
blocks = [(12, "$B$28", "LOW SCENARIO"), (24, "$C$28", "BASE SCENARIO"), (36, "$D$28", "HIGH SCENARIO")]
for top, mult, title in blocks:
    cell(m, f"A{top}", title, font=SECTION)
    hdr_yrs(top+1)
    rows = {
        "SMB new logos": top+2, "Mid new logos": top+3,
        "SMB new ARR": top+4, "Mid new ARR": top+5,
        "SMB ending ARR": top+6, "Mid ending ARR": top+7,
        "Total ending ARR": top+8, "Services (one-time)": top+9,
    }
    for name, r in rows.items():
        cell(m, f"A{r}", name)
    sn, mn, sa, ma, se, me, tot, svc = (rows[k] for k in
        ["SMB new logos","Mid new logos","SMB new ARR","Mid new ARR",
         "SMB ending ARR","Mid ending ARR","Total ending ARR","Services (one-time)"])
    for col, plancol in (("B","B"),("C","C"),("D","D")):
        # new logos = ROUND(base plan * multiplier)
        cell(m, f"{col}{sn}", f"=ROUND(Assumptions!{plancol}23*Assumptions!{mult},0)", fmt=NUM, border=True)
        cell(m, f"{col}{mn}", f"=ROUND(Assumptions!{plancol}24*Assumptions!{mult},0)", fmt=NUM, border=True)
        # new ARR = new logos * ACV
        cell(m, f"{col}{sa}", f"={col}{sn}*Assumptions!$B$10", fmt=USD, border=True)
        cell(m, f"{col}{ma}", f"={col}{mn}*Assumptions!$B$11", fmt=USD, border=True)
    # ending ARR roll-forward
    cell(m, f"B{se}", f"=B{sa}", fmt=USD, border=True)
    cell(m, f"C{se}", f"=B{se}*Assumptions!$B$16+C{sa}", fmt=USD, border=True)
    cell(m, f"D{se}", f"=C{se}*Assumptions!$B$16+D{sa}", fmt=USD, border=True)
    cell(m, f"B{me}", f"=B{ma}", fmt=USD, border=True)
    cell(m, f"C{me}", f"=B{me}*Assumptions!$B$17+C{ma}", fmt=USD, border=True)
    cell(m, f"D{me}", f"=C{me}*Assumptions!$B$17+D{ma}", fmt=USD, border=True)
    for col in ("B","C","D"):
        cell(m, f"{col}{tot}", f"={col}{se}+{col}{me}", fmt=USD0, font=BOLD, fill=CALC_FILL, border=True)
        cell(m, f"{col}{svc}", f"={col}{sn}*Assumptions!$B$12+{col}{mn}*Assumptions!$B$13", fmt=USD, border=True)

m.column_dimensions["A"].width = 22
for col in ("B","C","D"): m.column_dimensions[col].width = 14

# =========================================================================
# UNIT ECONOMICS
# =========================================================================
u = wb.create_sheet("Unit Economics")
u.sheet_view.showGridLines = False
cell(u, "A1", "Unit Economics", font=TITLE)

# logo-mix weights for the blended column
cell(u, "E3", "weights", font=BOLD)
cell(u, "F3", "n", font=BOLD)
cell(u, "E4", "SMB logos (Base)"); cell(u, "F4", "=SUM(Assumptions!B23:D23)", fmt=NUM)
cell(u, "E5", "Mid logos (Base)");  cell(u, "F5", "=SUM(Assumptions!B24:D24)", fmt=NUM)

cell(u, "A3", "Metric", font=HEAD, fill=HEAD_FILL)
for col, h in (("B","SMB"),("C","Mid"),("D","Blended")):
    cell(u, f"{col}3", h, font=HEAD, fill=HEAD_FILL, align="right")

def wavg(b, c):  # logo-weighted blend
    return f"=(B{b}*$F$4+C{c}*$F$5)/($F$4+$F$5)"

rows = [
    (4,  "ACV ($/yr)",                 "=Assumptions!B10", "=Assumptions!B11", USD0, "wavg"),
    (5,  "Sites per customer",         "=Assumptions!B42", "=Assumptions!B43", NUM,  None),
    (6,  "COGS — hosting & infra",     "=B5*Assumptions!$B$36", "=C5*Assumptions!$B$36", USD, None),
    (7,  "COGS — CAD-conversion compute","=B5*Assumptions!$B$37","=C5*Assumptions!$B$37", USD, None),
    (8,  "COGS — support / CS",        "=B5*Assumptions!$B$38", "=C5*Assumptions!$B$38", USD, None),
    (9,  "COGS — payments",            "=B4*Assumptions!$B$39", "=C4*Assumptions!$B$39", USD, None),
    (10, "Total COGS",                 "=SUM(B6:B9)",          "=SUM(C6:C9)",           USD0, "wavg"),
    (11, "Gross profit ($/yr)",        "=B4-B10",              "=C4-C10",               USD0, "wavg"),
    (12, "Gross margin %",             "=B11/B4",              "=C11/C4",               PCT,  "gm"),
    (14, "CAC per logo",               "=Assumptions!B31",     "=Assumptions!B32",      USD0, "wavg"),
    (15, "Onboarding fee",             "=Assumptions!B12",     "=Assumptions!B13",      USD0, None),
    (16, "Onboarding gross profit",    "=B15*Assumptions!$B$33","=C15*Assumptions!$B$33", USD, None),
    (17, "Net CAC (CAC − onb. GP)",    "=B14-B16",             "=C14-C16",              USD0, "wavg"),
    (19, "Monthly gross profit",       "=B11/12",              "=C11/12",               USD, None),
    (20, "CAC payback (gross)",        "=B14/B19",             "=C14/C19",              MON,  "pb"),
    (21, "Net CAC payback",            "=B17/B19",             "=C17/C19",              MON,  "pbn"),
    (23, "Logo churn / yr",            "=Assumptions!B18",     "=Assumptions!B19",      PCT,  None),
    (24, "Customer lifetime (yrs)",    "=1/B23",               "=1/C23",                '0.0', None),
    (25, "LTV (gross margin)",         "=B11*B24",             "=C11*C24",              USD0, "wavg"),
    (26, "LTV:CAC (gross)",            "=B25/B14",             "=C25/C14",              RAT,  "ltvcac"),
    (27, "LTV:CAC (net CAC)",          "=B25/B17",             "=C25/C17",              RAT,  "ltvcacn"),
]
for r, name, bf, cf, fmt, blend in rows:
    cell(u, f"A{r}", name, font=(BOLD if name in ("Gross margin %","LTV:CAC (net CAC)","Net CAC payback") else None))
    cell(u, f"B{r}", bf, fmt=fmt, border=True)
    cell(u, f"C{r}", cf, fmt=fmt, border=True)
    d = None
    if blend == "wavg":   d = wavg(r, r)
    elif blend == "gm":   d = f"=D11/D4"
    elif blend == "pb":   d = f"=D14/(D11/12)"
    elif blend == "pbn":  d = f"=D17/(D11/12)"
    elif blend == "ltvcac":  d = f"=D25/D14"
    elif blend == "ltvcacn": d = f"=D25/D17"
    if d:
        cell(u, f"D{r}", d, fmt=fmt, fill=CALC_FILL, border=True)

u.column_dimensions["A"].width = 28
for col in ("B","C","D"): u.column_dimensions[col].width = 13
u.column_dimensions["E"].width = 18
u.column_dimensions["F"].width = 8

wb.save("PCS-Pricing-Model.xlsx")
print("wrote PCS-Pricing-Model.xlsx")
