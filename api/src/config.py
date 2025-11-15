import os, json

CONFIG_PATH = "/data/config.json"

DEFAULT_CONFIG = {

    "database": {
        "type": "sqlite",                # 将来 "postgres", "mysql" などに変更可能
        "path": "/data/simplynote.db"
    },
    "upload": {
        "max_size_mb": 50,
        "dir": "/data/files"
    },
    "logging": {
        "level": "INFO"
    },
    "trash": {
        "enabled": True,
        "auto_empty_days": 30            # ゴミ箱を自動的に空にするまでの日数
    },
#   , "users": [
#         {"username": "user",  "password": "user_pass"}
#     ]
}

def load_config():

    os.makedirs("/data", exist_ok=True)

    if not os.path.exists(CONFIG_PATH):

        with open(CONFIG_PATH, "w") as f:
            json.dump(DEFAULT_CONFIG, f, indent=2)

        return DEFAULT_CONFIG

    with open(CONFIG_PATH) as f:

        try:
            config = json.load(f)
        except json.JSONDecodeError:
            config = DEFAULT_CONFIG

    for k, v in DEFAULT_CONFIG.items():
        config.setdefault(k, v)

    return config

