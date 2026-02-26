/**
 * AssetManager — uploads canvas images to Supabase Storage.
 *
 * Replaces base64 data URLs with permanent cloud URLs so that:
 *   - Project JSON stays small (no embedded images)
 *   - Images load across devices and browsers
 *   - Generated AI images are preserved in the cloud
 *
 * Usage:
 *   const url = await AssetManager.uploadDataUrl(projectId, base64DataUrl, 'image/png');
 *   element.src = url; // replace the base64 src
 */

import { supabase } from './supabase.js';

const BUCKET = 'project-assets';

function _dataUrlToBlob(dataUrl) {
    const [header, data] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)[1];
    const binary = atob(data);
    const arr = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
    return new Blob([arr], { type: mime });
}

function _ext(mimeType) {
    const map = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
    return map[mimeType] || 'bin';
}

async function _getSignedUrl(path) {
    const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, 60 * 60 * 24 * 365); // 1-year TTL
    if (error) throw error;
    return data.signedUrl;
}

const AssetManager = {

    /**
     * Upload a base64 data URL.
     * Returns a signed URL for the stored asset, or null on failure.
     */
    async uploadDataUrl(projectId, dataUrl, mimeType) {
        if (!dataUrl || !dataUrl.startsWith('data:')) return null;
        const user = await window.getCurrentUser?.();
        if (!user) return null;               // guest mode — skip upload

        try {
            const blob = _dataUrlToBlob(dataUrl);
            const ext  = _ext(blob.type || mimeType || 'image/png');
            const id   = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36);
            const path = `${user.id}/${projectId}/${id}.${ext}`;

            const { error: upErr } = await supabase.storage
                .from(BUCKET)
                .upload(path, blob, { contentType: blob.type, upsert: false });
            if (upErr) throw upErr;

            // Record in DB for indexing / cleanup
            await supabase.from('project_assets').insert({
                project_id:   projectId,
                owner_id:     user.id,
                storage_path: path,
                mime_type:    blob.type,
                size_bytes:   blob.size,
            }).throwOnError();

            return await _getSignedUrl(path);
        } catch (e) {
            console.warn('[AssetManager] Upload failed:', e);
            return null;
        }
    },

    /**
     * Refresh a signed URL that is close to expiry.
     * Pass the storage path extracted from the old signed URL.
     */
    async refreshSignedUrl(storagePath) {
        try { return await _getSignedUrl(storagePath); }
        catch { return null; }
    },

    /**
     * Extract the storage path from a Supabase signed URL.
     * Returns null if the URL is not a Supabase Storage URL.
     */
    extractPath(signedUrl) {
        try {
            const url = new URL(signedUrl);
            // Path pattern: /storage/v1/object/sign/<bucket>/<path>
            const m = url.pathname.match(/\/storage\/v1\/object\/sign\/[^/]+\/(.+)/);
            return m ? decodeURIComponent(m[1]) : null;
        } catch { return null; }
    },
};

// Expose globally
window.AssetManager = AssetManager;
