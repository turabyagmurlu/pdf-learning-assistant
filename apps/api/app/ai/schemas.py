# JSON schema tanımları (OpenAI structured outputs)

DOCUMENT_ANALYSIS_SCHEMA = {
    "name": "document_analysis",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "short_summary": {"type": "string"},
            "detailed_summary": {"type": "string"},
            "purpose": {"type": "string"},
            "difficulty_level": {"type": "string", "enum": ["beginner", "intermediate", "advanced"]},
            "outline": {"type": "array", "items": {"type": "string"}},
            "key_concepts": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "properties": {"term": {"type": "string"}, "definition": {"type": "string"}},
                    "required": ["term", "definition"],
                },
            },
            "difficult_concepts": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["short_summary", "detailed_summary", "purpose", "difficulty_level",
                     "outline", "key_concepts", "difficult_concepts"],
    },
}

STUDY_ITEMS_SCHEMA = {
    "name": "study_items",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object", "additionalProperties": False,
                    "properties": {
                        "type": {"type": "string", "enum": ["flashcard", "quiz", "open_question"]},
                        "question": {"type": "string"},
                        "answer": {"type": "string"},
                        "options": {"type": "array", "items": {"type": "string"}},
                        "difficulty": {"type": "string", "enum": ["easy", "medium", "hard"]},
                        "source_page": {"type": "integer"},
                    },
                    "required": ["type", "question", "answer", "options", "difficulty", "source_page"],
                },
            }
        },
        "required": ["items"],
    },
}
