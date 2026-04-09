export interface CatalogueEntry {
  id: string;
  curriculum: string;
  grade: number;
  subject: string;
  displayLabel: string;
  previewImage: string;
  tallyFormId: string;
  status: 'available' | 'coming-soon';
  stats?: {
    papersAnalysed: number;
    structuredCount: number;
    mcqCount: number;
    totalStructures: number;
  };
}

export const CATALOGUES: CatalogueEntry[] = [
  {
    id: 'caps-gr11-phys-sci',
    curriculum: 'CAPS',
    grade: 11,
    subject: 'Physical Sciences',
    displayLabel: 'Grade 11 Physical Sciences — CAPS',
    previewImage: '/catalogue-previews/caps-gr11-phys-sci.png',
    tallyFormId: 'MeJeXM',
    status: 'available',
    stats: {
      papersAnalysed: 15,
      structuredCount: 46,
      mcqCount: 42,
      totalStructures: 88,
    },
  },
  {
    id: 'caps-gr12-phys-sci',
    curriculum: 'CAPS',
    grade: 12,
    subject: 'Physical Sciences',
    displayLabel: 'Grade 12 Physical Sciences — CAPS',
    previewImage: '/catalogue-previews/caps-gr12-phys-sci.png',
    tallyFormId: 'CATALOGUE_FORM_ID_GR12',
    status: 'coming-soon',
  },
];
