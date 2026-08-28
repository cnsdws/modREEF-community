# Safe migration

```bash
cd /Users/Dennis/Code
mv modREEF modREEF-prototype
mkdir modREEF
cd modREEF
unzip ~/Downloads/modreef-platform-v2.zip
mv modreef-platform-v2/* modreef-platform-v2/.[!.]* .
rmdir modreef-platform-v2
cp -R ../modREEF-prototype/docs ./docs
cp -R ../modREEF-prototype/Graphics ./Graphics
pnpm install
pnpm fix:expo
pnpm typecheck
pnpm test
pnpm web
```

Keep `modREEF-prototype` until v2 launches successfully.
