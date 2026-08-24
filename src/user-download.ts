export function triggerUserDownload(
    blob: Blob,
    filename: string,
    documentRef: Document = document,
    urlRef: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
    schedule: typeof setTimeout = globalThis.setTimeout.bind(globalThis),
): void {
    const safeFilename = filename.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 180) || 'taskbridge-export.json';
    const objectUrl = urlRef.createObjectURL(blob);
    const anchor = documentRef.createElement('a');
    anchor.href = objectUrl;
    anchor.download = safeFilename;
    anchor.hidden = true;
    (documentRef.body || documentRef.documentElement).appendChild(anchor);
    anchor.click();
    anchor.remove();
    schedule(() => urlRef.revokeObjectURL(objectUrl), 1_000);
}
