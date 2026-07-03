# Wolf Equipment Catalogue

A CSV-driven equipment catalogue for a static website hosted on GitHub Pages.

## Critical privacy rule

**Never commit the raw Current RMS export to GitHub.** It may contain rental prices, purchase prices, replacement charges and other internal information. The `private-import` folder is ignored by Git.

Only the cleaned public catalogue generated in `equipment/` is committed.

## First-time setup on your Mac

1. Copy this folder into the root of your website repository.
2. Open the repository in VS Code.
3. Open **Terminal → New Terminal**.
4. Check Node is installed:

   ```bash
   node --version
   ```

   Use Node 20 or newer.

5. Install optional image optimisation support:

   ```bash
   npm install
   ```

6. Preview the supplied sample catalogue:

   ```bash
   npm run build
   npm run serve
   ```

7. Open `http://localhost:8080/equipment/`.

## Updating from Current RMS

1. Export the Current RMS products CSV.
2. Save it as:

   ```text
   private-import/current-products.csv
   ```

3. While the temporary Current RMS image links are fresh, run:

   ```bash
   npm run import
   ```

4. Review:

   ```text
   reports/catalogue-report.csv
   ```

5. Preview locally:

   ```bash
   npm run serve
   ```

6. Commit the generated public files:

   ```bash
   git add equipment data reports
   git commit -m "Update equipment catalogue"
   git push origin main
   ```

The private raw export will remain untracked because of `.gitignore`.

## Category files

### `data/category-rules.csv`

Bulk rules. The first matching enabled rule wins.

- `name_contains`: all alternatives are separated with `|` and treated as OR.
- `name_excludes`: any matching alternative prevents that rule from applying.
- Rules are processed in ascending `priority` order.

### `data/product-overrides.csv`

Exceptions by permanent Current RMS product ID. Overrides always win over rules.

Use it to:

- hide a product;
- change its public name;
- move it to another website category;
- set a custom display order.

### `data/category-order.csv`

Controls the exact customer-facing menu order and label. This is how categories such as **290 Silver, 290 Black, 390 Silver, 390 LED, Accessories** are sequenced independently of Current RMS Product Groups.

## Build commands

```bash
npm run build          # Build pages without fetching new images
npm run import         # Build and download images that are not cached
npm run refresh-images # Re-download all available images
npm run serve          # Local preview on port 8080
```

## Files generated for the public website

```text
equipment/
├── index.html
├── assets/
│   ├── catalogue.css
│   ├── catalogue.js
│   └── images/products/
├── data/catalogue.json
└── products/<product-slug>/index.html
```

## Add the catalogue to your main navigation

Link to:

```html
<a href="./equipment/">Equipment Hire</a>
```

If the link appears inside a subfolder, adjust the relative path accordingly.
