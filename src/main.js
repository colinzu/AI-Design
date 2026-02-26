/**
 * Homepage entry point
 * Imports are ordered to match the original script loading sequence.
 * All files use window.xxx for cross-module global sharing.
 *
 * New modules (Phase 2-3):
 *   supabase.js       — singleton Supabase client
 *   project-manager.js — cloud-backed ProjectManager (overrides canvas-project.js)
 *   team-manager.js   — team CRUD + profile management
 */
import './db/supabase.js';
import '../models.js';
import '../auth.js';
import '../canvas-project.js';
import './db/project-manager.js';
import './db/team-manager.js';
import '../script.js';
