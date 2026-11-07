# Media manager for Garmin watches

Manage the music, podcasts, audiobooks and maps on a Garmin watch from the
browser. The app talks MTP over WebUSB through
[libmtp-web](https://github.com/fstanis/libmtp-web) and runs entirely
client-side.

**Live:** https://garmin-manager.apps.stanis.me/

## Requirements

- Chrome 137+ (WebUSB and WebAssembly JSPI), served from HTTPS or `localhost`
- A Garmin device connected over USB in MTP mode

## Usage

Click **Connect device**, then drop audio or `.img` map files anywhere on the
page. The genre tag routes audio: `Podcast` and `Audiobook` go to their
folders, everything else goes to Music.

The watch groups chapters or episodes into one book or podcast only when both
album and artist match. Fix tags with ffmpeg:

```bash
ffmpeg -i chapter03.m4b -c copy \
  -metadata genre="Audiobook" -metadata album="The Hobbit" \
  -metadata artist="J. R. R. Tolkien" -metadata track="3" \
  chapter03.tagged.m4b
```

## Development

```bash
bun install
bun run dev
```

`bun run build` writes a static site to `dist/`. Pushes to `main` deploy it to
GitHub Pages.

`patches/hiq@4.2.11.patch` strips `::-webkit-file-upload-button` rules from
HiQ, because Bun's CSS parser rejects pseudo-classes after a pseudo-element.

## License

GPLv3. See [LICENSE](LICENSE).

Not affiliated with or endorsed by Garmin Ltd. Garmin is a trademark of Garmin
Ltd. or its subsidiaries.
