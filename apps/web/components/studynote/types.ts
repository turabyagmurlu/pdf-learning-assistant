/** Çalışma notu veri tipleri — API: app/api/study_notes.py */

export type StudyScope = { kind: "document" | "collection"; id: string };

export type MediaSection = { page: number; start: number; end?: number };

export type L1 = {
  paragraph: string | null;
  purpose: string | null;
  learn_goals: string[];
  reading_minutes: number | null;
  difficulty_level: string | null;
  difficulty_tr: string | null;
  difficult_concepts: string[];
  key_concepts: { term: string; definition?: string }[];
  outline: string[];
};

export type LessonSection = { title: string; page_start: number | null; body_md: string };

/** Belge L2 ders notu (doc_extracts kind='study_note') */
export type Lesson = {
  version: string;
  mode: "single" | "map_reduce";
  calls: number;
  sections: LessonSection[];
  concept_relations_md: string;
  misconceptions: string[];
  questions: { q: string; page: number | null }[];
  words: number;
  generated_at: string;
};

/** Defter sentez notu (collections.study_note) */
export type Synthesis = {
  version: string;
  overview_md: string;
  common_md: string;
  conflicts_md: string;
  complementary_md: string;
  reading_order: string[];
  questions: string[];
  words: number;
  generated_at: string;
};

export type Plan = { calls: number; mode: "single" | "map_reduce"; sections: number; chars?: number };

export type DocNote = {
  scope: "document";
  id: string;
  title: string;
  status: string;
  source_type: string;
  media_sections: MediaSection[] | null;
  l0: string | null;
  l1: L1;
  l2: Lesson | null;
  l2_at: string | null;
  l2_stale: boolean;
  plan: Plan;
  cached?: boolean;
  copied?: boolean;
};

export type ColSource = { k: number; document_id: string; title: string; status: string; l0: string | null; has_note: boolean };

export type ColNote = {
  scope: "collection";
  id: string;
  title: string;
  sources: ColSource[];
  ready: number;
  l2: Synthesis | null;
  l2_at: string | null;
  l2_stale: boolean;
  plan: Plan;
  cached?: boolean;
};

export type NoteData = DocNote | ColNote;

/** Atıf rozetine tıklanınca: belge + sayfa (video/seste bölüm numarası) */
export type OpenPage = (docId: string, page: number | null) => void;

export function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("tr-TR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch { return iso; }
}
