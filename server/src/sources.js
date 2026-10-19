// Whitelist of reputable organisations. The AI may only point to these IDs;
// the server maps IDs -> URLs, so the model can never invent a link.
// NOTE: these are landing pages of well-known organisations. They could not be
// opened from the build environment, so re-check them before any real deployment.
export const SOURCES = {
  who_bc: {
    org: "World Health Organization (WHO)",
    title: "Breast cancer – fact sheet",
    url: "https://www.who.int/news-room/fact-sheets/detail/breast-cancer",
    topics: "overview, global facts, early detection, screening, treatment"
  },
  nci_bc: {
    org: "National Cancer Institute (NCI)",
    title: "Breast cancer – general information",
    url: "https://www.cancer.gov/types/breast",
    topics: "overview, risk factors, symptoms, screening, treatment, genetics"
  },
  acs_bc: {
    org: "American Cancer Society (ACS)",
    title: "Breast cancer – information and resources",
    url: "https://www.cancer.org/cancer/types/breast-cancer.html",
    topics: "symptoms, risk factors, screening, diagnosis, stages, treatment, living with cancer"
  },
  komen: {
    org: "Susan G. Komen",
    title: "Breast cancer education and support",
    url: "https://www.komen.org/breast-cancer/",
    topics: "breast self-awareness, support, patient education"
  },
  moh_eg: {
    org: "Egyptian Ministry of Health and Population",
    title: "Ministry of Health and Population (official website)",
    url: "https://www.mohp.gov.eg",
    topics: "official Egyptian health services, national screening campaigns"
  },
  baheya: {
    org: "Baheya Foundation (Egypt)",
    title: "Baheya – early detection and treatment of breast cancer",
    url: "https://baheya.org",
    topics: "Egyptian breast cancer centre, early detection, support"
  }
};

export function sourceCatalogForPrompt() {
  return Object.entries(SOURCES)
    .map(([id, s]) => `- ${id}: ${s.org} — ${s.title} (topics: ${s.topics})`)
    .join("\n");
}

export function resolveSources(ids) {
  if (!Array.isArray(ids)) return [];
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (typeof id === "string" && Object.hasOwn(SOURCES, id) && !seen.has(id)) {
      seen.add(id);
      out.push({ id, ...SOURCES[id] });
    }
  }
  return out.slice(0, 3);
}
