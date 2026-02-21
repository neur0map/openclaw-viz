import { SupportedLanguages } from '../../config/supported-languages';

/* File extension to language mapping */
const EXTENSION_MAP: Record<string, SupportedLanguages> = {
  '.ts':   SupportedLanguages.TypeScript,
  '.tsx':  SupportedLanguages.TypeScript,
  '.js':   SupportedLanguages.JavaScript,
  '.jsx':  SupportedLanguages.JavaScript,
  '.py':   SupportedLanguages.Python,
  '.java': SupportedLanguages.Java,
  '.c':    SupportedLanguages.C,
  '.h':    SupportedLanguages.C,
  '.cpp':  SupportedLanguages.CPlusPlus,
  '.cc':   SupportedLanguages.CPlusPlus,
  '.cxx':  SupportedLanguages.CPlusPlus,
  '.hpp':  SupportedLanguages.CPlusPlus,
  '.hxx':  SupportedLanguages.CPlusPlus,
  '.hh':   SupportedLanguages.CPlusPlus,
  '.cs':   SupportedLanguages.CSharp,
  '.go':   SupportedLanguages.Go,
  '.rs':   SupportedLanguages.Rust,
};

/* Detect language from file extension */
export const getLanguageFromFilename = (filename: string): SupportedLanguages | null => {
  const dotIdx = filename.lastIndexOf('.');
  if (dotIdx === -1) return null;

  /* Prefer longer extensions (e.g. ".tsx" over ".ts") */
  const secondDotIdx = filename.lastIndexOf('.', dotIdx - 1);
  if (secondDotIdx !== -1) {
    const longExt = filename.slice(secondDotIdx);
    const longMatch = EXTENSION_MAP[longExt];
    if (longMatch !== undefined) return longMatch;
  }

  const ext = filename.slice(dotIdx);
  const match = EXTENSION_MAP[ext];
  return match !== undefined ? match : null;
};
