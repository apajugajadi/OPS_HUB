# Panduan Lengkap — OPS PERFORMANCE HUB (Full VS Code)

Ikutin urutan ini dari atas ke bawah, jangan lompat. Tiap bagian ada ✅ checkpoint — kalau checkpoint gagal, stop dan benerin dulu sebelum lanjut.

---

## BAGIAN 1 — Google Sheet & Apps Script (Backend)

### 1.1 Bikin Google Sheet baru
Buka [sheets.google.com](https://sheets.google.com) → bikin spreadsheet baru → kasih nama (mis. "OPS_HUB").

### 1.2 Buka Apps Script
**Extensions → Apps Script** (dari menu Google Sheets). Ini buka editor kosong.

### 1.3 Paste `code.gs`
- Di editor Apps Script, klik di area kode → **Ctrl+A** → **Delete** (pastiin beneran kosong)
- Buka file `code.gs` yang dikirim di pesan ini → **Ctrl+A** → **Ctrl+C**
- Balik ke Apps Script editor → **Ctrl+V**
- **Ctrl+S** (kasih nama project kalau diminta, bebas)

**✅ Checkpoint 1:** Tekan **Ctrl+F** di dalam editor Apps Script, cari `sync_raw_bulanan`. **Harus ketemu.** Kalau nggak ketemu, paste-nya kepotong — ulangi 1.3.

### 1.4 Jalankan setup (satu-satu, dari dropdown function di sebelah tombol ▷ Run)
Urutannya:
1. `setupSheets` → Run → kalau muncul popup izin akses, klik **Advanced/Lanjutan → Go to (nama project) (unsafe)** → **Allow/Izinkan**
2. `setupRawBulananSheets` → Run
3. `setupMitigasiSheets` → Run
4. `seedMappingKategoriDefault` → Run

**✅ Checkpoint 2:** Buka tab Google Sheets (bukan Apps Script), refresh. Harus ada tab-tab baru di bawah: `USER_ACCOUNTS`, `RAW_BULANAN_HASILPROD`, `RAW_BULANAN_DOWNTIME`, `RAW_BULANAN_PEMAKAIAN`, `RAW_BULANAN_NETOP`, `MITIGASI_ACTION`, `MITIGASI_LOG`, `MD_KLASIFIKASI`, dan beberapa lainnya.

### 1.5 Deploy sebagai Web App
- **Deploy → New deployment**
- Klik ⚙️ di sebelah "Select type" → **Web app**
- Execute as: **Me**
- Who has access: **Anyone**
- **Deploy** → izinkan akses kalau diminta lagi
- **Copy URL yang diakhiri `/exec`** — simpan, dipakai di Bagian 3

**✅ Checkpoint 3:** Buka tab baru di browser, paste:
```
<URL_TADI>/exec?uid=admin&pw=admin123ganti
```
Harus muncul JSON `{"ok":true,...}`. Kalau nggak, JANGAN lanjut — screenshot hasilnya dulu.

---

## BAGIAN 2 — Setup VS Code + GitHub (sekali aja)

### 2.1 Pastiin Git ke-install
Buka Terminal di VS Code: **Ctrl+`** (backtick, deket tombol Esc/angka 1). Ketik:
```powershell
git --version
```
Kalau error "not recognized", download & install dulu dari [git-scm.com/downloads](https://git-scm.com/downloads), restart VS Code.

### 2.2 Clone repo ke folder BARU
Di Terminal:
```powershell
git clone https://github.com/NAMA_USER/NAMA_REPO.git D:\OPS_HUB_repo
```
(Ganti `NAMA_USER/NAMA_REPO` sesuai repo GitHub Pages lo — cek dari tombol hijau **"Code"** di halaman repo GitHub, copy URL HTTPS-nya)

**✅ Checkpoint 4:** Muncul folder `OPS_HUB_repo` isinya `index.html` dan file lain dari repo lo. Kalau error "repository not found", cek lagi URL-nya.

### 2.3 Buka folder hasil clone di VS Code
**File → Open Folder** → pilih `D:\OPS_HUB_repo`.

---

## BAGIAN 3 — Update & Push `index.html`

### 3.1 Ganti `index.html` dengan versi terbaru
- Buka file `index.html` yang dikirim di pesan ini
- **Ctrl+A → Ctrl+C** (copy semua)
- Di VS Code, buka `index.html` yang ada di folder `OPS_HUB_repo`
- **Ctrl+A → Ctrl+V** (timpa semua isinya)
- **Ctrl+S**

### 3.2 Update `CONFIG.SYNC_URL`
- Di file itu juga, **Ctrl+F**, cari `SYNC_URL`
- Ganti URL di dalam kutip dengan URL dari **Checkpoint 3** (Bagian 1.5)
- **Ctrl+S**

### 3.3 Push ke GitHub
Buka Terminal (**Ctrl+`**), pastiin posisinya di folder `OPS_HUB_repo` (lihat prompt-nya), lalu:
```powershell
git add index.html
git commit -m "update ke versi terbaru"
git push
```
Kalau diminta login, ikutin popup browser-nya (approve akun GitHub).

**✅ Checkpoint 5:** Tunggu 1-2 menit, buka link GitHub Pages lo (`https://NAMA_USER.github.io/NAMA_REPO/`) di tab **Incognito**. Coba login pakai `admin` / `admin123ganti`. Harus berhasil masuk ke dashboard.

---

## BAGIAN 4 — Isi Data ke Google Sheets (biar gak salah)

⚠️ **Yang paling penting di bagian ini:** kolom tanggal harus di-set sebagai **Teks (Plain text)** DULU sebelum paste data — supaya Google Sheets nggak otomatis "mengoreksi" format tanggal lo jadi salah (bug yang bikin data nyasar ke bulan lain).

💡 **Cara paling aman (Recommended):** tiap sheet raw sekarang punya 3 kolom tambahan di paling kanan — **`Hari`**, **`Bulan`**, **`Tahun`** (isi angka, mis. `7`, `1`, `2026` buat 7 Januari 2026). Kalau kolom ini diisi, sync bakal **pakai ini langsung** dan nggak nyoba nebak-nebak format `Tgl post` sama sekali — jadi nggak akan pernah salah nyasar ke bulan lain. Kalau dikosongin, sync tetap fallback ke cara lama (baca `Tgl post`/`tanggal`). Boleh isi manual satu-satu atau drag-fill kalau satu batch datanya sebulan penuh.

### 4.1 Format kolom tanggal jadi Teks (lakukan di tiap sheet raw yang mau diisi)
Di sheet `RAW_BULANAN_DOWNTIME` (contoh):
1. Klik header kolom **C** (`Tgl post`) buat select seluruh kolom
2. **Format → Angka → Teks biasa (Plain text)**
3. Ulangi buat kolom **Awal** dan **Akhir** juga (kolom jam, sering ikut ke-auto-format juga)

Lakukan hal sama di `RAW_BULANAN_HASILPROD` dan `RAW_BULANAN_PEMAKAIAN` (kolom `Tgl post`), dan `RAW_BULANAN_NETOP` (kolom `tanggal`).

### 4.2 Isi kolom PU
Kolom **A** di semua sheet raw itu wajib diisi `PUJ`, `PUC`, atau `PUG` — tanpa ini, baris itu bakal dilewatin pas sync.

### 4.3 Paste data dari file SIAP asli
Mulai dari **baris 2** (baris 1 = header, jangan diubah/digeser). Kolom B dan seterusnya diisi sesuai urutan kolom asli file SIAP (Detail lengkap ada di 📋 di bawah).

📋 **Urutan kolom per sheet:**
| Sheet | Kolom (setelah PU) |
|---|---|
| `RAW_BULANAN_HASILPROD` | `#, Tgl post, Tipe, Line, Kimap, Produk, Ukuran, Batch Filling, Jumlah, Jumlah Bulk, Hari, Bulan, Tahun` |
| `RAW_BULANAN_DOWNTIME` | `#, Tgl post, Line, Kimap, Produk, Batch Filling, Detail, Solusi, Sebab, Kategori, Awal, Akhir, Durasi, Hari, Bulan, Tahun` |
| `RAW_BULANAN_PEMAKAIAN` | `#, Tgl post, Kimap, Produk, Batch Filling, Material, Deskripsi, Batch, Sloc, Jumlah, Reject, Hari, Bulan, Tahun` |
| `RAW_BULANAN_NETOP` | `net_op_id, tanggal, line, shift, durasi, Hari, Bulan, Tahun` |

Kolom `Hari/Bulan/Tahun` letaknya di paling kanan (kolom baru), sisanya tetap sesuai urutan asli — kalau sheet-nya udah pernah dipakai sebelum update ini, kolom baru itu bakal otomatis nongol sendiri di paling kanan pas lo jalanin sync sekali (nggak perlu ditambah manual).

**Catatan kolom Durasi (khusus `RAW_BULANAN_DOWNTIME`):** biarin **apa adanya** dari file SIAP — termasuk kalau ada yang **negatif** (itu normal, artinya downtime beneran; yang positif berarti waktu operasi biasa, bukan downtime).

**✅ Checkpoint 6:** Setelah paste, cek beberapa baris manual — kolom `Tgl post` harusnya masih kelihatan sebagai teks rata kiri (bukan rata kanan kayak angka/tanggal biasa). Kalau rata kanan, berarti masih ke-convert jadi Date, ulangi langkah 4.1.

### 4.4 Sync
- Login ke dashboard sebagai admin
- **Master Data → 🔄 Sync Raw Bulanan → Jalankan Sync Sekarang**
- Tunggu sampai muncul ringkasan hasil sync

**✅ Checkpoint 7:** Baca ringkasan hasil sync — kalau ada baris "⚠ PERHATIAN — baris yang tanggalnya gagal dibaca", catat nomor barisnya, cek manual di sheet, perbaiki, lalu sync ulang (aman diulang, gak numpuk data).

### 4.5 Cek hasil di dashboard
Buka tab **Downtime → Ringkasan**, DT Ratio dan angka lain harusnya sekarang mencerminkan data yang baru diisi.

---

## Kalau Ada yang Error di Tengah Jalan
Kabarin di checkpoint mana macetnya (jangan lanjut ke langkah berikutnya) + screenshot pesan errornya kalau ada — biar bisa langsung dibantu tanpa nebak-nebak dari awal lagi.
