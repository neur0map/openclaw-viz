import JSZip from 'jszip';
import { shouldIgnorePath } from '../config/ignore-service';

export interface FileEntry {
    path: string;
    content: string;
}

// Strip the single-level root folder that GitHub attaches to ZIP downloads
const findRootPrefix = (paths: string[]): string => {
    if (paths.length === 0) return '';

    const frequencyMap: Record<string, number> = {};
    let totalWithSegment = 0;

    for (const p of paths) {
        const slashIndex = p.indexOf('/');
        if (slashIndex === -1) continue;
        const segment = p.substring(0, slashIndex);
        frequencyMap[segment] = (frequencyMap[segment] || 0) + 1;
        totalWithSegment++;
    }

    if (totalWithSegment === 0) return '';

    let topSegment = '';
    let topCount = 0;
    for (const segment in frequencyMap) {
        if (frequencyMap[segment] > topCount) {
            topCount = frequencyMap[segment];
            topSegment = segment;
        }
    }

    if (topCount / totalWithSegment > 0.9) {
        return topSegment + '/';
    }

    return '';
};

export const extractZip = async (file: File): Promise<FileEntry[]> => {
    const zip = await JSZip.loadAsync(file);
    const entries = Object.entries(zip.files);

    const allPaths: string[] = [];
    for (const [relativePath, entry] of entries) {
        if (!entry.dir) {
            allPaths.push(relativePath);
        }
    }

    const rootPrefix = findRootPrefix(allPaths);

    const results: FileEntry[] = new Array(allPaths.length);
    let writeIndex = 0;

    for (const [relativePath, entry] of entries) {
        if (entry.dir) continue;

        const normalizedPath = rootPrefix && relativePath.startsWith(rootPrefix)
            ? relativePath.slice(rootPrefix.length)
            : relativePath;

        if (!normalizedPath) continue;
        if (shouldIgnorePath(normalizedPath)) continue;

        const content = await entry.async('string');

        results[writeIndex] = {
            path: normalizedPath,
            content: content,
        };
        writeIndex++;
    }

    return results.slice(0, writeIndex);
};
