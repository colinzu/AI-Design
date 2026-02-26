/**
 * Canvas editor entry point
 * Imports are ordered to match the original script loading sequence.
 * All files use window.xxx for cross-module global sharing.
 *
 * New modules (Phase 2-5):
 *   supabase.js       — singleton Supabase client
 *   project-manager.js — cloud-backed ProjectManager (overrides canvas-project.js)
 *   asset-manager.js  — image upload to Supabase Storage
 *   team-manager.js   — team CRUD + profile management
 *   share-manager.js  — share links + project visibility
 *   collab-manager.js — real-time collaboration (Broadcast + Presence)
 */
import './db/supabase.js';
import '../models.js';
import '../auth.js';
import '../canvas-project.js';
import './db/project-manager.js';
import './db/asset-manager.js';
import './db/team-manager.js';
import './db/share-manager.js';
import '../canvas-engine.js';
import './collab/collab-manager.js';
import '../canvas.js';
import '../canvas-gen.js';
import '../canvas-inspiration.js';
import '../canvas-layers.js';
