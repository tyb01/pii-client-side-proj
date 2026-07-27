from openmed import OnnxModel
from collections import defaultdict

CONFIDENCE_THRESHOLD = 0.1

model = OnnxModel.from_pretrained("OpenMed/OpenMed-PII-SuperClinical-Small-44M-v1-onnx-android")

# Full real document texts from your actual sample set —
# combined into one large multi-document input to simulate
# a full patient chart upload (multiple reports, one processing pass)

documents = {

"Cataraqui - GynOnc Initial Consult": """
Cataraqui Regional Cancer Centre
Department of Oncology & Laboratory Medicine
88 Stuart Street, Kingston, ON K7L 2V7 - Tel (613) 555-3000
GYNECOLOGIC ONCOLOGY CONSULTATION
Initial Consultation - Abnormal Vaginal Bleeding / Cervical Mass
Date of Consultation: 2024-09-20 Patient: Beaumont, Diane Rose
MRN: CRC-0338715 DOB / Age / Sex: 1975-06-22 / 49 / Female
Consultant: Hannah Whitmore, MD, FRCSC (Gynecologic
Oncology)
Referred by: Ellen Cho, MD, CCFP (Family Medicine)
REASON FOR CONSULTATION
Progressive abnormal vaginal bleeding and a friable cervical mass identified on examination; referred for evaluation of
suspected cervical malignancy.
HISTORY OF PRESENT ILLNESS
This 49-year-old woman developed intermittent postcoital spotting in May 2024. Over the following months she
experienced gradually progressive irregular vaginal bleeding, watery vaginal discharge and mild pelvic discomfort. By
September 2024 bleeding episodes became more frequent and occasionally occurred independent of intercourse,
prompting referral to gynecology.
PAST MEDICAL HISTORY
Mild hypertension.
No significant cardiovascular, renal or autoimmune disease.
GYNECOLOGIC HISTORY
G2P2.
No prior cervical procedures.
Irregular cervical cancer screening; last Pap smear approximately 6 years earlier.
No HPV vaccination history.
SOCIAL HISTORY
Former smoker (8 pack-years; quit 2012). Occasional alcohol consumption. Otherwise active and relatively healthy.
PHYSICAL EXAMINATION
Friable exophytic cervical lesion with contact bleeding; approximately 4-5 cm cervical mass.
Mild left parametrial thickening.
ASSESSMENT
Clinically suspicious locally advanced cervical malignancy with left parametrial involvement.
Electronically signed: Hannah Whitmore, MD, FRCSC (Gynecologic Oncology)
Date/Time authenticated: 2024-09-20 15:10
""",

"Cataraqui - Laboratory Baseline": """
Cataraqui Regional Cancer Centre
88 Stuart Street, Kingston, ON K7L 2V7 - Tel (613) 555-3000
LABORATORY REPORT
Accession No.: LAB24-284410 Patient: Beaumont, Diane Rose
MRN: CRC-0338715 Collected: 2024-09-24 08:10
Reported: 2024-09-24 12:30 Ordering Physician: Rebecca Lindgren, MD, FRCPC
(Medical Oncology)
Hemoglobin 11.2 g/dL, WBC 6.9 x10^9/L, Platelets 342 x10^9/L
Creatinine 0.78 mg/dL, eGFR > 90 mL/min
AST 24 U/L, ALT 28 U/L, CRP 9 mg/L
Electronically signed: Clinical Biochemistry / Hematology - Laboratory Medicine
Date/Time authenticated: 2024-09-24 12:30
""",

"Cataraqui - Pelvic Ultrasound": """
Cataraqui Regional Cancer Centre
88 Stuart Street, Kingston, ON K7L 2V7 - Tel (613) 555-3000
PELVIC ULTRASOUND REPORT
Accession No.: RAD24-US-04471 Patient: Beaumont, Diane Rose
MRN: CRC-0338715 DOB / Sex: 1975-06-22 / Female
Date of Service: 2024-10-04
Ordering Physician: Hannah Whitmore, MD, FRCSC (Gynecologic Oncology)
Reading Physician: Thomas Beaulieu, MD, FRCPC (Diagnostic Radiology)
FINDINGS: Enlarged, heterogeneous cervix with a lesion measuring approximately 4.2 cm.
IMPRESSION: Bulky heterogeneous cervical lesion (~4.2 cm); recommend pelvic MRI for local staging.
Electronically signed: Thomas Beaulieu, MD, FRCPC (Diagnostic Radiology)
Date/Time authenticated: 2024-10-04 11:30
""",

"Cataraqui - Colposcopy": """
Cataraqui Regional Cancer Centre
88 Stuart Street, Kingston, ON K7L 2V7 - Tel (613) 555-3000
COLPOSCOPY REPORT
Date of Procedure: 2024-10-08 Patient: Beaumont, Diane Rose
MRN: CRC-0338715 Colposcopist: Hannah Whitmore, MD, FRCSC (Gynecologic Oncology)
Multiple colposcopically-directed cervical biopsies were obtained and submitted for histopathology
(Accession S24-021884).
Electronically signed: Hannah Whitmore, MD, FRCSC (Gynecologic Oncology)
Date/Time authenticated: 2024-10-08
""",

"Harbourview - Core Needle Biopsy": """
Harbourview Regional Cancer Centre
250 Lakeshore Boulevard East, Toronto, ON M5A 1B2 - Tel (416) 555-2000
SURGICAL PATHOLOGY REPORT
Accession No.: S22-014728 Patient: Whitfield, Margaret Eleanor
MRN: HRC-0447192 DOB / Age / Sex: 1969-03-14 / 53 / Female
Date Reported: 2022-10-14 Ordering Physician: James Okafor, MD, FRCSC (Surgical Oncology)
Referring / Family MD: Daniel Foster, MD, CCFP (Family Medicine)
FINAL DIAGNOSIS: INVASIVE DUCTAL CARCINOMA (no special type / NST).
Electronically signed: Michael Tran, MD, FRCPC (Anatomic Pathology)
Date/Time authenticated: 2022-10-14 15:22
""",

"Harbourview - Breast Biomarker": """
Harbourview Regional Cancer Centre
250 Lakeshore Boulevard East, Toronto, ON M5A 1B2 - Tel (416) 555-2000
BREAST BIOMARKER REPORT
Accession No.: S22-014728-IHC Patient: Whitfield, Margaret Eleanor MRN: HRC-0447192
Date Reported: 2022-10-15
Ordering Physician: Priya Raman, MD, FRCPC (Medical Oncology)
Estrogen Receptor (ER) Positive - 85% nuclei. HER2/neu (IHC) 1+ Negative.
Electronically signed: Michael Tran, MD, FRCPC (Anatomic Pathology)
Date/Time authenticated: 2022-10-15 11:40
""",

"Harbourview - Breast MRI": """
Harbourview Regional Cancer Centre
250 Lakeshore Boulevard East, Toronto, ON M5A 1B2 - Tel (416) 555-2000
BREAST MRI REPORT
Accession No.: RAD22-MR-02219 Patient: Whitfield, Margaret Eleanor
MRN: HRC-0447192 DOB / Sex: 1969-03-14 / Female
Date of Service: 2022-10-18
Ordering Physician: James Okafor, MD, FRCSC (Surgical Oncology)
Reading Radiologist: Anita Desai, MD, FRCPC (Diagnostic Radiology)
IMPRESSION: Multifocal left breast carcinoma; index lesion 3.4 cm.
Electronically signed: Anita Desai, MD, FRCPC (Diagnostic Radiology)
Date/Time authenticated: 2022-10-19 09:40
""",

"Harbourview - Laboratory": """
Harbourview Regional Cancer Centre
250 Lakeshore Boulevard East, Toronto, ON M5A 1B2 - Tel (416) 555-2000
LABORATORY REPORT
Accession No.: LAB22-338207 Patient: Whitfield, Margaret Eleanor
MRN: HRC-0447192 Collected: 2022-10-20 08:15
Ordering Physician: Priya Raman, MD, FRCPC (Medical Oncology)
CA 15-3 42.6 U/mL ELEVATED. CA 27.29 48.2 U/mL ELEVATED.
Electronically signed: Clinical Biochemistry - Laboratory Medicine
Date/Time authenticated: 2022-10-20 12:40
""",

"Manhattan Comprehensive - Surgical Pathology": """
Manhattan Comprehensive Cancer Center
1290 York Avenue, New York, NY 10021 - Tel (212) 555-0182 | Fax (212) 555-0199
SURGICAL PATHOLOGY REPORT
Patient Donnelly, Katherine R. Accession S24-018472
MRN MCC-00847192 Collected 09/12/2024
DOB 03/14/1977 Received 09/12/2024
Sex Female Reported 09/16/2024
FINAL PATHOLOGIC DIAGNOSIS: Invasive squamous cell carcinoma, keratinizing type.
Electronically signed by: Susan R. Feldman, MD
Signed: 09/16/2024
""",

"Manhattan Comprehensive - Molecular Pathology": """
Manhattan Comprehensive Cancer Center
1290 York Avenue, New York, NY 10021 - Tel (212) 555-0182 | Fax (212) 555-0199
MOLECULAR PATHOLOGY REPORT
Patient Donnelly, Katherine R. Accession MOL24-00931
MRN MCC-00847192 Specimen Source S24-018472
DOB 03/14/1977 Reported 10/02/2024
BIOMARKER: PIK3CA E545K Activating (pathogenic). TP53 R248Q Pathogenic.
Electronically signed by: Priya N. Desai, MD, PhD
Signed: 10/02/2024
""",

"Manhattan Comprehensive - Laboratory": """
Manhattan Comprehensive Cancer Center
1290 York Avenue, New York, NY 10021 - Tel (212) 555-0182 | Fax (212) 555-0199
LABORATORY REPORT
Patient Donnelly, Katherine R. Accession LAB24-556210
MRN MCC-00847192 Collected 09/12/2024
DOB 03/14/1977 Reported 09/13/2024
Ordering MD Rajesh K. Malhotra, MD
Hemoglobin 9.8 g/dL Low. SCC-Ag 8.4 ng/mL Elevated.
Electronically signed by: Robert K. Lin, MD
Signed: 09/13/2024
""",

"Manhattan Comprehensive - MRI Pelvis": """
Manhattan Comprehensive Cancer Center
1290 York Avenue, New York, NY 10021 - Tel (212) 555-0182 | Fax (212) 555-0199
DIAGNOSTIC IMAGING REPORT — MRI PELVIS
Patient Donnelly, Katherine R. Accession MRI24-114087
MRN MCC-00847192 Exam Date 09/18/2024
DOB 03/14/1977 Radiologist Laura J. Kim, MD
FINDINGS: Cervical mass measuring 52 x 48 x 45 mm.
Electronically signed by: Laura J. Kim, MD
Signed: 09/18/2024
""",

"Billings Clinic - Chest X-Ray": """
CONFIDENTIAL — PATIENT HEALTH INFORMATION
Billings Clinic Cancer Center
801 N 29th St, Billings, MT 59101 | Tel: (406) 555-0100
RADIOLOGY REPORT
Patient Robert H. Callahan
DOB / Age / Sex 08/14/1961 | 64 years | Male
MRN MT-2026-04471
Exam Date March 2, 2026
Ordering Provider Dr. Karen Voss, MD — Broadwater Community Health Center, Townsend, MT
Interpreting Radiologist Dr. Susan R. Ellery, MD — Diagnostic Radiology, Billings Clinic
Accession No. RAD-2026-100234
FINDINGS: Right upper lobe mass-like opacity measuring approximately 4 cm.
Electronically signed by: Susan R. Ellery, MD
Date/Time Signed: 03/02/2026 2:14 PM
""",

"Billings Clinic - CT Chest Abdomen Pelvis": """
CONFIDENTIAL — PATIENT HEALTH INFORMATION
Billings Clinic Cancer Center
801 N 29th St, Billings, MT 59101 | Tel: (406) 555-0100
RADIOLOGY REPORT
Patient Robert H. Callahan
DOB / Age / Sex 08/14/1961 | 64 years | Male
MRN MT-2026-04471
Exam Date March 4, 2026
Ordering Provider Dr. Michael T. Anders, MD — Medical Oncology / Hematology, Billings Clinic Cancer Center
Interpreting Radiologist Dr. Susan R. Ellery, MD — Diagnostic Radiology, Billings Clinic
Accession No. RAD-2026-100311
FINDINGS: Right upper lobe mass measuring 4.2 x 3.8 x 3.5 cm.
Electronically signed by: Susan R. Ellery, MD
Date/Time Signed: 03/04/2026 5:02 PM
""",

"Penobscot Bay - Laboratory": """
Penobscot Bay Regional Cancer Center
410 State Street, Bangor, ME 04401 - Tel (207) 555-4000
LABORATORY REPORT
Accession No.: LAB24-118820 Patient: Harmon, Walter James
MRN: PBR-2210934 Collected: 2024-04-03 08:10
Ordering Physician: Steven Alvarez, MD (Pulmonary & Critical Care Medicine)
Serum Mesothelin (SMRP) 18.4 nmol/L MARKEDLY ELEVATED.
Electronically signed: Clinical Biochemistry / Hematology - Laboratory Medicine
Date/Time authenticated: 2024-04-03 13:20
""",

"Penobscot Bay - Respiratory Consult": """
Penobscot Bay Regional Cancer Center
410 State Street, Bangor, ME 04401 - Tel (207) 555-4000
RESPIRATORY MEDICINE CONSULTATION
Date: 2024-04-05 Patient: Harmon, Walter James
MRN: PBR-2210934 Consultant: Steven Alvarez, MD (Pulmonary & Critical Care Medicine)
Referred by: Ellen Marsh, MD (Family Medicine) DOB / Age / Sex: 1952-11-08 / 71 / Male
71-year-old man presenting in April 2024 with progressive exertional dyspnea.
Worked as a naval shipyard engineer for 22 years (1974-1996). Lives with his wife in coastal Maine.
Electronically signed: Steven Alvarez, MD (Pulmonary & Critical Care Medicine)
Date/Time authenticated: 2024-04-05
""",

"Penobscot Bay - CT Chest Abdomen Pelvis": """
Penobscot Bay Regional Cancer Center
410 State Street, Bangor, ME 04401 - Tel (207) 555-4000
CT CHEST, ABDOMEN AND PELVIS
Accession No.: RAD24-CT-04410 Patient: Harmon, Walter James
MRN: PBR-2210934 DOB / Sex: 1952-11-08 / Male
Date of Service: 2024-04-04
Ordering Physician: Steven Alvarez, MD (Pulmonary & Critical Care Medicine)
Reading Physician: Karen Whitlock, MD (Diagnostic Radiology)
IMPRESSION: Findings consistent with malignant pleural mesothelioma, Stage IV.
Electronically signed: Karen Whitlock, MD (Diagnostic Radiology)
Date/Time authenticated: 2024-04-05 10:40
""",

}


def chunk_text(text, max_tokens=400, overlap=50):
    """
    Split text into overlapping chunks safely under the model's window.
    Using 400 (not 512) leaves headroom for tokenizer differences,
    and overlap prevents entities from being cut across a chunk boundary.
    """
    words = text.split()
    chunks = []
    start = 0
    while start < len(words):
        end = start + max_tokens
        chunks.append(" ".join(words[start:end]))
        start += (max_tokens - overlap)
    return chunks


def run_chunked(model, text, threshold=0.6):
    all_hits = []
    for i, chunk in enumerate(chunk_text(text)):
        entities = model(chunk)
        for e in entities:
            d = e.to_dict()
            if d["score"] >= threshold:
                d["chunk_index"] = i
                all_hits.append(d)
    return all_hits


# ---- Combine everything into ONE large input (simulates a full multi-doc chart upload) ----
combined_text = "\n\n".join(documents.values())

print(f"Total combined input length: {len(combined_text)} characters, "
      f"{len(combined_text.split())} words, {len(documents)} documents\n")

num_chunks = len(chunk_text(combined_text))
print(f"Split into {num_chunks} chunks (400 words each, 50-word overlap)\n")

print("="*70)
print("RUNNING MODEL ON CHUNKED INPUT")
print("="*70)

hits = run_chunked(model, combined_text, threshold=CONFIDENCE_THRESHOLD)

print(f"\nTotal entities detected (above {CONFIDENCE_THRESHOLD} threshold): {len(hits)}\n")

# Group by label for easier evaluation
by_label = defaultdict(list)
for e in hits:
    by_label[e["label"]].append((e["text"].strip(), round(e["score"], 3), e["chunk_index"]))

for label, items in sorted(by_label.items()):
    print(f"\n[{label}] — {len(items)} matches")
    for text, score, chunk_idx in items:
        print(f"    '{text}'  score={score}  (chunk {chunk_idx})")