# Design System — Neuro. Dashboard

Dokumen ini mendeskripsikan design system untuk dashboard **Neuro.** (admin dashboard penjualan produk digital 3D). Mendukung **Light Mode** dan **Dark Mode**.

---

## 1. Prinsip Desain

- **Bersih & lapang**: banyak whitespace, kartu putih dengan sudut membulat besar.
- **Satu warna dominan**: royal blue sebagai identitas (sidebar, tombol utama, ikon kartu).
- **Soft & friendly**: sudut sangat membulat, bayangan halus, ilustrasi 3D.
- **Data jelas**: angka besar dan tebal, label kecil berwarna abu-abu, tren memakai warna hijau/merah.
- **Konsisten**: semua kartu memakai pola yang sama (ikon kotak biru + judul + menu `⋮`).

---

## 2. Color Tokens

### 2.1 Brand & Semantic (sama di kedua mode, disesuaikan sedikit)

| Token             | Light     | Dark      | Penggunaan                                           |
| ----------------- | --------- | --------- | ---------------------------------------------------- |
| `--primary`       | `#3451D1` | `#5B7BFF` | Sidebar, tombol utama, ikon judul kartu, garis chart |
| `--primary-hover` | `#2B44B8` | `#7391FF` | Hover tombol utama                                   |
| `--primary-soft`  | `#E8ECFC` | `#222A5C` | Background item aktif / badge lembut                 |
| `--accent`        | `#6CC8F2` | `#4FB4E6` | Tombol "Contact Us", banner promo                    |
| `--success`       | `#2FB584` | `#45D6A0` | Tren naik, label Available                           |
| `--success-soft`  | `#E4F7EF` | `#12332A` | Background chip Available                            |
| `--danger`        | `#E5677B` | `#FF7F93` | Tren turun, label Pending                            |
| `--danger-soft`   | `#FCEBEE` | `#3A1E26` | Background chip Pending                              |
| `--info`          | `#3B8FE8` | `#5AA5F5` | Tooltip chart                                        |

### 2.2 Neutral / Surface

| Token               | Light                        | Dark                         | Penggunaan                        |
| ------------------- | ---------------------------- | ---------------------------- | --------------------------------- |
| `--bg-page`         | gradient `#DCE3F7 → #EEF1FB` | gradient `#0A0D1C → #11152B` | Background halaman luar           |
| `--bg-app`          | `#F3F5FC`                    | `#0F1325`                    | Container utama (frame dashboard) |
| `--surface`         | `#FFFFFF`                    | `#181D35`                    | Kartu                             |
| `--surface-2`       | `#F6F8FD`                    | `#1F2542`                    | Input search, item list, hover    |
| `--border`          | `#E6E9F4`                    | `#2A3158`                    | Garis pemisah, border input       |
| `--text-primary`    | `#1E2347`                    | `#F1F3FC`                    | Judul, angka besar                |
| `--text-secondary`  | `#6E7597`                    | `#A3AACB`                    | Subjudul, label                   |
| `--text-muted`      | `#9AA0BC`                    | `#6F7699`                    | Placeholder, sumbu chart          |
| `--text-on-primary` | `#FFFFFF`                    | `#FFFFFF`                    | Teks di atas biru                 |

### 2.3 Sidebar

| Token                        | Light     | Dark      |
| ---------------------------- | --------- | --------- |
| `--sidebar-bg`               | `#3451D1` | `#1B2466` |
| `--sidebar-item-text`        | `#DCE3FF` | `#B9C3F5` |
| `--sidebar-item-active-bg`   | `#FFFFFF` | `#2B3786` |
| `--sidebar-item-active-text` | `#1E2347` | `#FFFFFF` |
| `--sidebar-support-bg`       | `#4A66DE` | `#26307F` |

### 2.4 Banner Promo

| Mode  | Gradient                                            |
| ----- | --------------------------------------------------- |
| Light | `linear-gradient(135deg, #6FCBF3 0%, #8FDAF7 100%)` |
| Dark  | `linear-gradient(135deg, #1E5E86 0%, #2A7FA8 100%)` |

### 2.5 CSS Variables

```css
:root,
[data-theme="light"] {
  --primary: #3451d1;
  --primary-hover: #2b44b8;
  --primary-soft: #e8ecfc;
  --accent: #6cc8f2;
  --success: #2fb584;
  --success-soft: #e4f7ef;
  --danger: #e5677b;
  --danger-soft: #fcebee;
  --info: #3b8fe8;

  --bg-page: linear-gradient(135deg, #dce3f7, #eef1fb);
  --bg-app: #f3f5fc;
  --surface: #ffffff;
  --surface-2: #f6f8fd;
  --border: #e6e9f4;
  --text-primary: #1e2347;
  --text-secondary: #6e7597;
  --text-muted: #9aa0bc;

  --sidebar-bg: #3451d1;
  --sidebar-item-text: #dce3ff;
  --sidebar-item-active-bg: #ffffff;
  --sidebar-item-active-text: #1e2347;
  --sidebar-support-bg: #4a66de;

  --banner-bg: linear-gradient(135deg, #6fcbf3, #8fdaf7);
  --shadow-card: 0 8px 24px rgba(52, 81, 209, 0.08);
  --shadow-frame: 0 24px 60px rgba(52, 81, 209, 0.15);
}

[data-theme="dark"] {
  --primary: #5b7bff;
  --primary-hover: #7391ff;
  --primary-soft: #222a5c;
  --accent: #4fb4e6;
  --success: #45d6a0;
  --success-soft: #12332a;
  --danger: #ff7f93;
  --danger-soft: #3a1e26;
  --info: #5aa5f5;

  --bg-page: linear-gradient(135deg, #0a0d1c, #11152b);
  --bg-app: #0f1325;
  --surface: #181d35;
  --surface-2: #1f2542;
  --border: #2a3158;
  --text-primary: #f1f3fc;
  --text-secondary: #a3aacb;
  --text-muted: #6f7699;

  --sidebar-bg: #1b2466;
  --sidebar-item-text: #b9c3f5;
  --sidebar-item-active-bg: #2b3786;
  --sidebar-item-active-text: #ffffff;
  --sidebar-support-bg: #26307f;

  --banner-bg: linear-gradient(135deg, #1e5e86, #2a7fa8);
  --shadow-card: 0 8px 24px rgba(0, 0, 0, 0.35);
  --shadow-frame: 0 24px 60px rgba(0, 0, 0, 0.5);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    /* salin token dark di sini untuk mode "system" */
  }
}
```

---

## 3. Typography

**Font**: `Plus Jakarta Sans` (alternatif: `Poppins`, `Inter`). Fallback: `system-ui, -apple-system, "Segoe UI", sans-serif`.

| Style              | Size / Line | Weight  | Contoh                           |
| ------------------ | ----------- | ------- | -------------------------------- |
| Display / Stat     | 36 / 44     | 600     | `1,134`, `$4,231`, `$537`        |
| H1 (greeting name) | 28 / 36     | 600     | "Lucy Lure"                      |
| H2 (banner title)  | 20 / 28     | 600     | "Want some EXTRA Money?"         |
| H3 (card title)    | 15 / 22     | 600     | "Total Product", "Top Products"  |
| Body               | 14 / 22     | 400     | Teks umum                        |
| Body-strong        | 14 / 22     | 600     | Nama produk, label menu          |
| Caption            | 12 / 18     | 400–500 | "3D Illustrations", "this week"  |
| Micro              | 10 / 14     | 500     | Label sumbu chart, "Admin Tools" |

Aturan: angka statistik memakai `font-variant-numeric: tabular-nums`; letter-spacing normal; judul tidak uppercase.

---

## 4. Spacing, Radius, Shadow

**Spacing (basis 4px)**: `4 · 8 · 12 · 16 · 20 · 24 · 32 · 40`

| Token               | Nilai | Penggunaan             |
| ------------------- | ----- | ---------------------- |
| `--radius-frame`    | 28px  | Frame dashboard        |
| `--radius-card`     | 20px  | Kartu                  |
| `--radius-sidebar`  | 24px  | Sidebar                |
| `--radius-button`   | 10px  | Tombol                 |
| `--radius-input`    | 10px  | Search                 |
| `--radius-icon-box` | 6px   | Kotak ikon kartu       |
| `--radius-thumb`    | 12px  | Thumbnail produk       |
| `--radius-chip`     | 6px   | Chip Available/Pending |

**Shadow**: kartu memakai `--shadow-card` (lembut, bertint biru); frame memakai `--shadow-frame`. Di dark mode shadow lebih gelap dan dibantu `1px solid var(--border)`.

---

## 5. Layout

Ukuran acuan desktop **1440 × 1024**.

```
┌────────────────────────────────────────────────────────────┐
│ ┌────────┐  Header (greeting · Upload · Search · Bell)     │
│ │        │ ┌──────────────────────────┐ ┌───────────────┐  │
│ │Sidebar │ │ Banner Promo             │ │ Top Products  │  │
│ │ 240px  │ └──────────────────────────┘ │ (5 item list) │  │
│ │        │ ┌────────────┐┌────────────┐ │               │  │
│ │        │ │Total Prod. ││Total Earn. │ │               │  │
│ │        │ └────────────┘└────────────┘ └───────────────┘  │
│ │        │ ┌──────────────────────────┐ ┌───────────────┐  │
│ │        │ │ Latest Download (chart)  │ │ Balances      │  │
│ └────────┘ └──────────────────────────┘ └───────────────┘  │
└────────────────────────────────────────────────────────────┘
```

- Frame: padding 24px, gap antar kolom 24px.
- **Sidebar**: lebar 240px, tinggi penuh frame.
- **Konten utama**: grid 12 kolom → area kiri 8 kolom, kolom kanan 4 kolom (`Top Products` + `Balances`).
- Gap antar kartu: 24px; padding dalam kartu: 24px.
- `Total Product` dan `Total Earning`: masing-masing 4 dari 8 kolom (50/50).

### Breakpoint

| Breakpoint  | Perilaku                                                       |
| ----------- | -------------------------------------------------------------- |
| ≥ 1280px    | Layout penuh seperti di atas                                   |
| 1024–1279px | Sidebar ringkas (ikon saja, 80px)                              |
| 768–1023px  | Sidebar jadi drawer; grid 1 kolom + kolom kanan turun ke bawah |
| < 768px     | Satu kolom, header menumpuk, tombol Upload jadi ikon           |

---

## 6. Komponen

### 6.1 Sidebar

- Background `--sidebar-bg`, radius 24px, padding 20px.
- **Logo**: ikon kubus 3D + wordmark "Neuro." (24px, weight 700, putih).
- Label grup "Admin Tools": micro, warna `--sidebar-item-text` opacity 70%.
- **Menu item**: tinggi 44px, radius 10px, ikon 20px + label 14px/600, gap 12px.
  - Default: teks `--sidebar-item-text`, transparan.
  - Hover: `rgba(255,255,255,0.1)`.
  - **Active** (Overview): background `--sidebar-item-active-bg`, teks `--sidebar-item-active-text`, ikon berwarna `--primary`.
- Daftar menu: Overview, Products, Campaigns, Schedules, Payouts, Statements, Settings.
- **Support box** (bawah): background `--sidebar-support-bg`, radius 14px, padding 16px; teks 11px putih; tombol "Contact Us" memakai `--accent` dengan teks putih.

### 6.2 Header

- Kiri: "Welcome Back," (14px, `--text-secondary`) + nama user (H1).
- Kanan (rata tengah vertikal, gap 16px): tombol **Upload Product**, **Search**, **Notification bell**.

### 6.3 Buttons

| Varian                 | Style                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Primary**            | bg `--primary`, teks putih, tinggi 44px, padding 0 20px, radius 10px, ikon 18px di kiri. Hover `--primary-hover`. |
| **Primary full-width** | Sama, lebar 100% (mis. "Withdraw Money"), tinggi 48px.                                                            |
| **Secondary (putih)**  | bg `#FFFFFF` (dark: `--surface-2`), teks `--text-primary`, weight 600 (mis. "Referral Program").                  |
| **Accent**             | bg `--accent`, teks putih (mis. "Contact Us").                                                                    |
| **Icon button**        | 44×44, bg `--surface`, radius 14px, badge notifikasi bulat 16px `--primary` teks putih 10px.                      |

Focus state: `outline: 2px solid var(--primary); outline-offset: 2px`. Disabled: opacity 50%.

### 6.4 Search Input

- Tinggi 44px, bg `--surface`, radius 10px, ikon search 18px `--text-muted` di kiri, placeholder "Search".
- Focus: border `--primary` + ring `rgba(52,81,209,.2)`.

### 6.5 Card (dasar)

- bg `--surface`, radius 20px, padding 24px, `--shadow-card`.
- **Header kartu**: kotak ikon 16×16 `--primary` (radius 4px) + judul H3 + menu `⋮` di kanan (ikon `--text-muted`).

### 6.6 Banner Promo ("Want some EXTRA Money?")

- bg `--banner-bg`, radius 20px, tinggi ±200px, padding 32px.
- Judul putih H2, deskripsi 12px putih opacity 80%.
- Tombol Secondary "Referral Program".
- Kanan: ilustrasi 3D (monitor + keyboard biru), overflow sedikit keluar dari kartu untuk efek depth.

### 6.7 Stat Card (Total Product / Total Earning)

- Header kartu standar.
- Angka: Display style; unit kecil ("Items") 12px `--text-secondary`.
- Tren: caption berwarna — `+10% this week` (`--success`), `-22% this week` (`--danger`).
- **Sparkline** di kanan: garis 2px, tanpa sumbu; area gradient di bawah garis (`color` 25% → 0%). Naik = hijau, turun = merah.

### 6.8 Top Products (list)

- Tiap item: tinggi 56px, thumbnail 44×44 radius 12px (background pastel berbeda), nama (14px/600), kategori (12px `--text-secondary`), chevron `›` di kanan.
- Gap antar item 12px; hover: bg `--surface-2`, radius 12px.
- Pastel thumbnail light: `#E3ECFF`, `#FFE9D6`, `#E3F7EE`, `#FFE4E4`, `#DDF4FA` — dark mode: pakai opacity 20% dari warna yang sama.

### 6.9 Chart "Latest Download" (Line/Area)

- Garis 2.5px `--primary`, kurva halus (monotone), area gradient `--primary` 18% → 0%.
- Grid horizontal tipis `--border`, tanpa grid vertikal; sumbu Y: 0–400 (step 100); sumbu X: Mon–Sun, micro `--text-muted`.
- **Titik aktif**: lingkaran 8px `--primary` + garis vertikal putus-putus.
- **Tooltip**: bg `--info`, teks putih 12px/600, radius 8px, padding 6px 10px, panah kecil di bawah.

### 6.10 Balances

- Dua kolom dipisah garis vertikal `--border`.
- Angka Display; di bawahnya **chip**:
  - Available: bg `--success-soft`, teks `--success`.
  - Pending: bg `--danger-soft`, teks `--danger`.
  - Chip: 11px/500, padding 4px 12px, radius 6px.
- Tombol "Withdraw Money" Primary full-width di bawah.

### 6.11 Theme Toggle

- Tombol bulat 40×40 di pojok kiri bawah (ikon setengah lingkaran).
- Opsi: **Light · Dark · System**. Simpan di `localStorage` (`theme`), set `data-theme` pada `<html>`.
- Transisi: `background-color, color, border-color 200ms ease`.

---

## 7. Iconography

- Gaya **outline**, stroke 1.5–1.75px, ukuran 20px (menu) / 18px (tombol) / 16px (kartu).
- Library yang disarankan: Lucide / Phosphor.
- Warna mengikuti teks; ikon aktif memakai `--primary`.

## 8. Ilustrasi & Gambar

- Gaya **3D soft render** (glossy, pastel + biru).
- Thumbnail produk persegi, rasio 1:1, `object-fit: cover`.
- Dark mode: ilustrasi tetap sama; background thumbnail diredupkan agar tidak silau.

## 9. Motion

| Elemen              | Efek                                     | Durasi            |
| ------------------- | ---------------------------------------- | ----------------- |
| Hover tombol / item | warna & `translateY(-1px)`               | 150ms ease-out    |
| Pergantian tema     | transisi warna                           | 200ms ease        |
| Chart saat load     | garis tergambar (stroke-dashoffset)      | 800ms ease-in-out |
| Kartu muncul        | fade + translateY(8px → 0), stagger 60ms | 300ms             |

Hormati `prefers-reduced-motion: reduce` (matikan animasi non-esensial).

## 10. Aksesibilitas

- Kontras teks minimal **4.5:1** (body) dan **3:1** (teks besar & ikon).
- Teks putih di atas `--accent` (`#6CC8F2`) kontrasnya rendah → gunakan weight 600 dan ukuran ≥ 14px, atau gelapkan menjadi `#3FA9DD` untuk tombol kecil.
- Warna tren tidak boleh menjadi satu-satunya penanda: sertakan tanda `+` / `-` (sudah ada) atau ikon panah.
- Semua elemen interaktif bisa diakses keyboard dengan focus ring jelas.
- Chart diberi `aria-label` dan tabel data alternatif; tooltip juga muncul saat focus.
- Ukuran target sentuh minimal 44×44px.

## 11. Contoh Konfigurasi Tailwind

```js
// tailwind.config.js
module.exports = {
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: "var(--primary)",
        accent: "var(--accent)",
        success: "var(--success)",
        danger: "var(--danger)",
        surface: "var(--surface)",
        "surface-2": "var(--surface-2)",
        border: "var(--border)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
      },
      borderRadius: { card: "20px", frame: "28px", btn: "10px" },
      boxShadow: { card: "var(--shadow-card)", frame: "var(--shadow-frame)" },
      fontFamily: { sans: ["Plus Jakarta Sans", "system-ui", "sans-serif"] },
    },
  },
};
```

## 12. Checklist Implementasi

- [ ] Token warna light & dark terpasang di `:root` dan `[data-theme="dark"]`
- [ ] Font Plus Jakarta Sans dimuat (weight 400/500/600/700)
- [ ] Sidebar, Header, Banner, Stat Card, Top Products, Chart, Balances
- [ ] Theme toggle (Light/Dark/System) + persist
- [ ] Responsif pada semua breakpoint
- [ ] Uji kontras & navigasi keyboard
