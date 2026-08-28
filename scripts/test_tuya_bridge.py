import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class TuyaBridgeEnvironmentTests(unittest.TestCase):
    def test_missing_optional_environment_file_does_not_mask_runtime_credentials(self):
        repository = Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as directory:
            environment = {
                **os.environ,
                "MODREEF_ENV_FILE": str(Path(directory) / "missing.env"),
                "GHOME_WP12_DEVICE_ID": "test-device",
                "GHOME_WP12_IP": "127.0.0.1",
                "GHOME_WP12_LOCAL_KEY": "0123456789abcdef",
            }
            result = subprocess.run(
                [sys.executable, "scripts/tuya-bridge.py"],
                cwd=repository,
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )

        self.assertEqual(result.returncode, 1)
        self.assertIn("Usage: tuya-bridge.py", result.stderr)
        self.assertNotIn("FileNotFoundError", result.stderr)


if __name__ == "__main__":
    unittest.main()
