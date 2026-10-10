# gnome-hypersync

keeps your whole gnome setup in sync between your own machines, peer to peer

no account no cloud no github token. you pair your machines once with an invite code and after that they sync directly whenever both are online. if one was offline it catches up later

## what syncs

- gnome shell extensions, the ones you installed yourself. missing ones get installed from extensions.gnome.org and enabled or disabled like on your other machine
- extension settings (`/org/gnome/shell/extensions/`)
- keybindings and custom shortcuts
- look and feel (`/org/gnome/desktop/interface/` so theme icons fonts color scheme etc)
- wallpaper, light and dark, the image itself gets sent over and saved in `~/.local/share/backgrounds/gnome-hypersync`
- the gtk shell icon and cursor themes you use if they live in your home folder (`~/.themes` `~/.icons` `~/.local/share/themes` `~/.local/share/icons`)

## what doesnt sync

stuff that only makes sense on one machine or is private never leaves it

- monitor ids and sizes, scaling
- history keys (recent colors, played songs and so on)
- anything with a path into your home folder or a `file://` path
- hardware addresses like your paired bluetooth devices
- anything you exclude yourself with `exclude`

extensions and themes are never uninstalled or replaced. an extension that doesnt support your gnome version is not installed and a theme folder that already exists with different content is left alone, you just get told

## safety

this changes your real desktop so it is careful about it

- it shows you every change and asks before applying (unless you pass `--yes`)
- before every apply it makes a backup, `rollback` puts the old values back on that machine only
- if two machines changed the same thing while apart the newest change wins
- everything is encrypted and only your paired devices can read it

## install

needs node and gnome (tested on gnome 50)

```
git clone https://github.com/af44n/gnome-hypersync
cd gnome-hypersync
npm install
npm link   # optional, gives you the gnome-hypersync command
```

## use it

on the first machine

```
gnome-hypersync init
gnome-hypersync invite
```

it prints a code. on the other machine

```
gnome-hypersync join <code>
```

the new machine shows 6 digits, type them on the first one and you are paired. both keep syncing until you hit ctrl+c. later just run `gnome-hypersync run` on each machine

other commands

```
gnome-hypersync diff               what the other machines changed that this one doesnt have
gnome-hypersync apply              apply that
gnome-hypersync backups            list backups
gnome-hypersync rollback [id]      undo an apply on this machine
gnome-hypersync devices            list paired devices
gnome-hypersync remove <key>       remove a device
gnome-hypersync exclude <key|dir/> never sync this on this machine
gnome-hypersync include <key|dir/> undo an exclude
```

newly installed extensions might need a log out and back in before gnome loads them

## stack

plain javascript on node, no build step

- [hyperswarm](https://github.com/holepunchto/hyperswarm) finds your other machines and connects to them
- [autobase](https://github.com/holepunchto/autobase) lets every machine write and gives all of them the same view
- [hyperbee](https://github.com/holepunchto/hyperbee) holds the settings as key value pairs inside that view
- [hyperblobs](https://github.com/holepunchto/hyperblobs) carries files like the wallpaper and theme folders, every machine has its own encrypted blob core
- [corestore](https://github.com/holepunchto/corestore) and [hypercore](https://github.com/holepunchto/hypercore) store everything as signed append only logs
- [blind-pairing](https://github.com/holepunchto/blind-pairing) does the invite code pairing
- `dconf` `gnome-extensions` and `tar` for talking to gnome and packing themes

## tests

```
npm test
```

the tests never touch your real settings. they run in their own dbus session with a temporary dconf database home and data folder, and the runner fails if your real dconf extensions themes or wallpapers changed. there are tests with two devices syncing in one process, pairing on a local test dht and two real cli processes pairing and syncing

## status

completed. everything on the list syncs: extensions and their settings, keybindings, look and feel, wallpaper and themes. all of it is tested with two devices in the sandbox, settings and extensions also went through a real run over the real dht

## license

mit
