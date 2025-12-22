# Fabric Notebook: TTL クリーンアップ
# raw パーティション (14日以前) を削除

from notebookutils import mssparkutils
from datetime import datetime, timedelta

TTL_DAYS = 14
RAW_BASE = "/lakehouse/default/Files/shortcuts/raw"

cutoff_date = datetime.utcnow().date() - timedelta(days=TTL_DAYS)
print(f"Deleting raw partitions older than {cutoff_date}")

sources = ["graph_interactions", "users", "copilot_studio_transcript", "o365_audit"]

for source in sources:
    path = f"{RAW_BASE}/{source}"
    try:
        folders = mssparkutils.fs.ls(path)
        for folder in folders:
            if folder.name.startswith("date="):
                date_str = folder.name.split("=")[1].strip("/")
                try:
                    folder_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                    if folder_date < cutoff_date:
                        mssparkutils.fs.rm(folder.path, True)
                        print(f"Deleted: {folder.path}")
                except ValueError:
                    print(f"Skipped invalid date folder: {folder.name}")
    except Exception as e:
        print(f"Error processing {source}: {e}")

print("TTL cleanup completed.")
