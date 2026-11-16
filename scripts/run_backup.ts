import { NexusDatabase } from '../src/core/db_sqlite_wal.js';
import { VaultBackupManager } from '../src/core/vault_backup.js';

async function main() {
  console.log('🔄 Iniciando Snapshot Atómico de SQLite...');
  const db = new NexusDatabase('nexus_quant.db');
  const backupManager = new VaultBackupManager();

  try {
    const res = await backupManager.executeBackup(db);
    console.log(`✅ Snapshot Completado con Éxito:`);
    console.log(`   - Local: ${res.localPath} (${(res.sizeBytes / 1024).toFixed(1)} KB)`);
    if (res.cloudPath) {
      console.log(`   - Nube (OneDrive / Sync): ${res.cloudPath}`);
    } else {
      console.log(`   - Nube: No detectada carpeta OneDrive automática.`);
    }
  } finally {
    db.close();
  }
}

main().catch(err => {
  console.error('❌ Error ejecutando snapshot:', err);
  process.exit(1);
});
