import path from 'node:path';
import fs from 'node:fs';
import { NexusDatabase } from './db_sqlite_wal.js';

export interface BackupResult {
  localPath: string;
  cloudPath?: string;
  timestamp: string;
  sizeBytes: number;
}

export class VaultBackupManager {
  private localBackupDir: string;
  private cloudBackupDir?: string;

  constructor(baseDir: string = process.cwd()) {
    this.localBackupDir = path.join(baseDir, 'backups');
    
    // Si OneDrive está disponible en el equipo del usuario, habilitar replicación en la nube
    const userProfile = process.env.USERPROFILE || 'C:\\Users\\gamer';
    const oneDrivePath = path.join(userProfile, 'OneDrive');
    if (fs.existsSync(oneDrivePath)) {
      this.cloudBackupDir = path.join(oneDrivePath, 'NexusQuant_Backups');
    }
  }

  public async executeBackup(db: NexusDatabase): Promise<BackupResult> {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[:.]/g, '-');
    const filename = `nexus_vault_${dateStr}.db`;

    // 1. Guardar localmente
    const localTarget = path.join(this.localBackupDir, filename);
    await db.backupToFile(localTarget);
    const stats = fs.statSync(localTarget);

    let cloudTarget: string | undefined;

    // 2. Replicar a la nube si la carpeta existe
    if (this.cloudBackupDir) {
      if (!fs.existsSync(this.cloudBackupDir)) {
        fs.mkdirSync(this.cloudBackupDir, { recursive: true });
      }
      cloudTarget = path.join(this.cloudBackupDir, filename);
      fs.copyFileSync(localTarget, cloudTarget);
    }

    // 3. Poda de retención: Mantener sólo los últimos 7 días (rotación automática)
    this.pruneOldBackups(this.localBackupDir, 7);
    if (this.cloudBackupDir) {
      this.pruneOldBackups(this.cloudBackupDir, 7);
    }

    return {
      localPath: localTarget,
      cloudPath: cloudTarget,
      timestamp: dateStr,
      sizeBytes: stats.size
    };
  }

  private pruneOldBackups(dir: string, maxDays: number): void {
    if (!fs.existsSync(dir)) return;
    const nowMs = Date.now();
    const maxAgeMs = maxDays * 24 * 60 * 60 * 1000;

    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.startsWith('nexus_vault_') && file.endsWith('.db')) {
        const fullPath = path.join(dir, file);
        try {
          const stats = fs.statSync(fullPath);
          if (nowMs - stats.mtimeMs > maxAgeMs) {
            fs.unlinkSync(fullPath);
          }
        } catch {
          // Ignorar archivos en uso
        }
      }
    }
  }
}
