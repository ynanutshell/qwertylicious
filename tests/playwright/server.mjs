// A test server for the Playwright specs. It serves the stylesheets and scripts that a real page loads,
// concatenated from source on every request, and fixture pages that copy the rendered markup.
// Where a spec checks one piece of markup, the fixture takes it from the template file itself (see README.md).
import { createServer } from "node:http"
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const qwerty = resolve(process.env.QWERTY_DIR || join(here, "../.."))
const emissary = resolve(process.env.EMISSARY_DIR || join(qwerty, "../emissary"))
const templates = join(emissary, "_embed/templates")
const port = Number(process.argv[2] || 8777)

if (!existsSync(templates)) {
	console.error(`Emissary not found at ${emissary}; set EMISSARY_DIR`)
	process.exit(1)
}

// The episodes, in the list's order
const episodes = [
	{ id: "6ad24ab9c00dfca0c02cd451", title: "Episode Three: A Title Long Enough to Wrap Onto a Second Line" },
	{ id: "6ad24ab9c00dfca0c02cd450", title: "Episode Two" },
	{ id: "6ad24ab9c00dfca0c02cd452", title: "Episode One" },
]

// The Timeline entries, in the tab's order
const entries = [
	{ id: "6ad6445b9d33845fe83e2a01", title: "Declaration of Independence", date: "Thursday, July 4, 1776", short: "Jul 4, 1776" },
	{ id: "6ad6445b9d33845fe83e2a02", title: "Constitution Signed", date: "Monday, September 17, 1787", short: "Sep 17, 1787" },
	{ id: "6ad6445b9d33845fe83e2a03", title: "Constitution Ratified", date: "Saturday, June 21, 1788", short: "Jun 21, 1788" },
]

// concat joins every file in a folder, in name order, as a bundle does
function concat(folder) {
	return readdirSync(folder).filter((name) => !name.startsWith(".")).sort()
		.map((name) => readFileSync(join(folder, name), "utf8")).join("\n")
}

function read(path) {
	return readFileSync(path, "utf8")
}

// stripComments removes HTML comments, as the minifier does before Go parses a view
function stripComments(html) {
	return html.replace(/<!--[\s\S]*?-->/g, "")
}

// icons turns {{icon "name"}} into the Bootstrap icon it renders
function icons(html) {
	return html.replace(/\{\{icon "([^"]+)"\}\}/g, '<i class="bi bi-$1"></i>')
}

// arrow renders episode-arrow-back.html or episode-arrow-next.html: enabled for a neighbor, disabled for none
function arrow(file, neighbor) {
	const source = stripComments(read(join(qwerty, "qwerty-episode", file)))
	const [enabled, disabled] = source.split("{{- else -}}")
	const chosen = neighbor ? enabled : disabled
	return icons(chosen.replace(/\{\{-? ?(if|end)[^}]*\}\}/g, "")).trim()
}

// heading is a title's opening tag, exactly as a modal.html writes it
function heading(file, tag) {
	const match = stripComments(read(join(qwerty, file))).match(new RegExp(`<${tag}[^>]*>`))
	return match[0]
}

// dateCell is the list's date cell from qwerty-collection/items-podcast.html, with the date filled in
function dateCell() {
	const source = stripComments(read(join(qwerty, "qwerty-collection/items-podcast.html")))
	const cell = source.match(/<td class="qwerty-podcast-date[\s\S]*?<\/td>/)[0]
	return cell.replace(/\{\{-? ?\.PublishDate[^}]*\}\}/, "Oct 9, 2025").replace(/\{\{[^}]*\}\}[^<]*<span[^>]*>[^<]*<\/span>\{\{[^}]*\}\}/, "")
}

function episodeModal(index) {
	const episode = episodes[index]
	const above = episodes[index - 1]
	const below = episodes[index + 1]
	const link = (kind, neighbor) => neighbor ? `<a class="qwerty-episode-${kind}" hidden aria-hidden="true" tabindex="-1" href="/${neighbor.id}" data-episode-id="${neighbor.id}" hx-get="/${neighbor.id}/modal" hx-target="aside" hx-push-url="false">${kind}</a>` : ""
	return read(join(here, "fixtures/episode-modal.html"))
		.replaceAll("${H2}", heading("qwerty-episode/modal.html", "h2"))
		.replaceAll("${ID}", episode.id)
		.replaceAll("${TITLE}", episode.title)
		.replaceAll("${BACK}", arrow("episode-arrow-back.html", above))
		.replaceAll("${NEXT}", arrow("episode-arrow-next.html", below))
		.replaceAll("${LINKS}", link("prev", above) + link("next", below))
}

// entryNeighbor is one link of qwerty-timeline-entry/entry-neighbors.html, the modal's previous and next entries
function entryNeighbor(direction, entry) {
	const arrow = `<span class="qwerty-entry-arrow"><i class="bi bi-arrow-${direction == "prev" ? "left" : "right"}"></i></span>`
	const text = `<span class="qwerty-entry-neighbor-text"><span class="text-xs text-gray">${entry.short}</span><span class="qwerty-entry-neighbor-title">${entry.title}</span></span>`
	const next = direction == "next" ? " qwerty-entry-neighbor-next" : ""
	return `<a class="qwerty-entry-neighbor${next} turboclick" data-modal-go="${direction}" href="/${entry.id}" hx-get="/${entry.id}/modal" hx-target="aside" hx-push-url="false">${direction == "prev" ? arrow + text : text + arrow}</a>`
}

function entryModal(index) {
	const entry = entries[index]
	const prev = entries[index - 1]
	const next = entries[index + 1]
	const links = (prev ? entryNeighbor("prev", prev) : "") + (next ? entryNeighbor("next", next) : "")
	return read(join(here, "fixtures/entry-modal.html"))
		.replaceAll("${H1}", heading("qwerty-timeline-entry/modal.html", "h1"))
		.replaceAll("${ID}", entry.id)
		.replaceAll("${TITLE}", entry.title)
		.replaceAll("${DATE}", entry.date)
		.replaceAll("${NEIGHBORS}", `<div role="navigation" class="qwerty-entry-neighbors" aria-label="Timeline">${links}</div>`)
}

function eventModal() {
	return read(join(here, "fixtures/event-modal.html"))
		.replaceAll("${H1}", heading("qwerty-event/modal.html", "h1"))
		.replaceAll("${ID}", calendarEvent.id)
		.replaceAll("${TITLE}", calendarEvent.title)
		.replaceAll("${DATE}", calendarEvent.date)
}

// modalFor renders the modal of the episode, entry, or event with this id, or "" when there is none
function modalFor(id) {
	const index = episodes.findIndex((episode) => episode.id == id)
	if (index >= 0) {
		return episodeModal(index)
	}
	const entryIndex = entries.findIndex((entry) => entry.id == id)
	if (entryIndex >= 0) {
		return entryModal(entryIndex)
	}
	if (calendarEvent.id == id) {
		return eventModal()
	}
	return ""
}

// listRoute answers the list spec's Save with every value it received, by name, in the order posted
async function listRoute(request, response, path) {

	if (path != "/list" || request.method != "POST") {
		return false
	}

	const posted = {}

	for (const [name, value] of (await formData(request)).entries()) {
		posted[name] = [...(posted[name] || []), value]
	}

	htmlResponse(response, escapeHTML(JSON.stringify(posted)))
	return true
}

// uploadRoute serves the upload spec: an image of the size its path names, a Save answered with the name of each
// file and the value of each field it received, and a delete that answers nothing or, with ?fail, a 500
async function uploadRoute(request, response, path, url) {

	let match

	if ((match = path.match(/^\/upload\/image\/(\d+)x(\d+)$/))) {
		const [width, height] = [Number(match[1]), Number(match[2])]
		response.writeHead(200, { "Content-Type": "image/svg+xml" })
		response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#264653"/><stop offset="1" stop-color="#e9c46a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${width * 0.75}" cy="${height * 0.3}" r="${Math.min(width, height) * 0.15}" fill="#fff8"/></svg>`)
		return true
	}

	if (path == "/upload/delete" && request.method == "POST") {
		response.writeHead(url.searchParams.has("fail") ? 500 : 200, { "Content-Type": "text/html" })
		response.end("")
		return true
	}

	if (path != "/upload" || request.method != "POST") {
		return false
	}

	const posted = {}

	for (const [name, value] of (await formData(request)).entries()) {
		if (typeof value == "string" || value.name != "") {
			posted[name] = [...(posted[name] || []), typeof value == "string" ? value : `file:${value.name}`]
		}
	}

	htmlResponse(response, escapeHTML(JSON.stringify(posted)))
	return true
}

// profileTabLink is one tab link of qwerty-common/profile-tabs.html, read from the template, for the collection $tabID on $userID's profile
function profileTabLink(label, tabID, userID, selected) {
	const link = stripComments(read(join(qwerty, "qwerty-common/profile-tabs.html"))).match(/<a [^>]*>/)[0]
	return link.replaceAll("{{$tabID}}", tabID).replaceAll("{{$userID}}", userID)
		.replace(/\{\{if [^}]*\}\}true\{\{else\}\}false\{\{end\}\}/, selected ? "true" : "false") + `${label}</a>`
}

// profileTab is the Articles tab link, selected, for the sorting spec's profile
function profileTab() {
	return profileTabLink("Articles", "articles", "author", true)
}

// profileFrame is qwerty-outbox/outbox.html's element around #profile-tabs, with the script that keeps <main>'s scroll across a swap, if it still has one
function profileFrame(tab) {
	const source = stripComments(read(join(qwerty, "qwerty-outbox/outbox.html")))
	const open = source.match(/<div class="margin-top"(?: script="[^"]*")?>/)[0]
	return `${open}${tab}</div>`
}

// sortForm is qwerty-common/layout.html's sortable branch up to its cards: the form's opening tag, and anything it loads first
function sortForm() {
	const source = stripComments(read(join(qwerty, "qwerty-common/layout.html")))
	const branch = source.split("{{- else -}}")[1].split('{{- template "layout-cards" $cards -}}')[0]
	return branch.replaceAll("{{$class}}", "cols-1").replaceAll("{{$sortURL}}", "/articles/sort").trim()
}

// articleCard is qwerty-common/layout-column.html's card for an Article, with its drag handle and without its pencil
function articleCard(article) {
	const source = stripComments(read(join(qwerty, "qwerty-common/layout-column.html")))
	const link = source.match(/<a href="\/\{\{\.Token\}\}"[^>]*>/)[0].replace("{{.Token}}", article.token)
	const handle = source.match(/\{\{- if \$canSort -\}\}([\s\S]*?)\{\{- end -\}\}/)[1].replace("{{.StreamID}}", article.id)
	return `<div class="pos-relative hover-trigger">${link}${article.title}</a>${icons(handle)}</div>`
}

// profileArticles is the Articles tab, as list.html swaps it into #profile-tabs, in Custom order
function profileArticles() {
	return `<div id="profile-tabs"><div role="tablist" class="pills">${profileTab()}</div>${sortForm()}${articles.map(articleCard).join("")}</form></div>`
}

// tagPills is qwerty-collection/tag-pills.html's row for a collection with $selected open, its row and pills taken from the template
function tagPills(selected, collection = "gallery", profile = "author") {
	const source = stripComments(read(join(qwerty, "qwerty-collection/tag-pills.html")))
	const row = source.match(/<div role="tablist"[^>]*>/)[0]
	const [all, tag] = source.match(/<a [^>]*>[^<]*<\/a>/g)
	const fill = (link, value) => link
		.replace(/\{\{if ne `` \$query\}\}[?&]\{\{\$query\}\}\{\{end\}\}/g, "")
		.replace(/\{\{if eq (``|\.) \$selected\}\}true\{\{else\}\}false\{\{end\}\}/, value == selected ? "true" : "false")
		.replaceAll("{{$collectionID}}", collection)
		.replaceAll("{{$profileTab}}", `/@${profile}?tab=${collection}`)
		.replaceAll("{{. | urlquery}}", encodeURIComponent(value))
		.replaceAll("{{.}}", value)
	return row + fill(all, "") + galleryTags.map((value) => fill(tag, value)).join("") + "</div>"
}

// galleryTab is the gallery's tab, as list.html swaps it into #profile-tabs, with photos taller than the window below the pills
function galleryTab(selected) {
	return `<div id="profile-tabs"><div role="tablist" class="pills"><a role="tab" aria-selected="true">Gallery</a></div>${tagPills(selected)}<div style="height: 2000px">${selected || "All"} photos</div></div>`
}

// essays are an Article collection's posts, tagged with the gallery's tags, few enough that the tab ends above the bottom of the window
const essays = [
	{ token: "on-travel", title: "On Travel", tags: ["travel"] },
	{ token: "on-food", title: "On Food", tags: ["food"] },
	{ token: "on-both", title: "On Both", tags: ["travel", "food"] },
]

// essayCard is qwerty-common/layout-column.html's card for an Article with no image, read from the template
function essayCard(essay) {
	const source = stripComments(read(join(qwerty, "qwerty-common/layout-column.html")))
	const card = source.match(/<a href="\/\{\{\.Token\}\}"[\s\S]*?<\/a>/)[0]
		.replace(/\{\{- if ne "" \.IconURL -\}\}[\s\S]*?\{\{- end -\}\}/, "")
		.replace("{{.Token}}", essay.token)
		.replace("{{.Name}}", essay.title)
		.replace("{{.Description}}", "A summary of the essay.")
		.replace("{{.PublishDate | shortDate}}", "Nov 6, 2026")
	return `<div class="pos-relative hover-trigger">${card}</div>`
}

// columnistTabs is the columnist's tab bar, as list.html draws it: the Essays and Scrapbook collections, with $open selected
function columnistTabs(open) {
	return `<div class="profile-tabs-row flex-row flex-wrap flex-align-center"><div role="tablist" class="pills">${profileTabLink("Essays", "essays", "columnist", open == "essays")}${profileTabLink("Scrapbook", "scrapbook", "columnist", open == "scrapbook")}</div></div>`
}

// essaysTab is an Article collection's tab, as list.html swaps it into #profile-tabs: its pills, then the cards $selected shows, in one column
function essaysTab(selected) {
	const shown = essays.filter((essay) => selected == "" || essay.tags.includes(selected))
	return `<div id="profile-tabs">${columnistTabs("essays")}${tagPills(selected, "essays", "columnist")}<div class="cols-1">${shown.map(essayCard).join("")}</div></div>`
}

// scrapbookTab is the columnist's other collection: no pills, and content taller than the window
function scrapbookTab() {
	return `<div id="profile-tabs">${columnistTabs("scrapbook")}<div style="height: 2000px">The scrapbook</div></div>`
}

// mapPlaces are a Map's places, tagged with the gallery's tags, and far enough apart that one tag's view leaves another place out
const mapPlaces = [
	{ token: "los-angeles", label: "Los Angeles", latitude: 34.05, longitude: -118.24, tags: ["travel"] },
	{ token: "san-francisco", label: "San Francisco", latitude: 37.77, longitude: -122.42, tags: ["food"] },
	{ token: "san-diego", label: "San Diego", latitude: 32.72, longitude: -117.16, tags: ["travel", "food"] },
]

// mapTab is a Map's tab, as list.html swaps it into #profile-tabs: its pills, then items-map.html from its map onward,
// read from the template, with no saved view and the places $selected shows
function mapTab(selected) {
	const shown = mapPlaces.filter((place) => selected == "" || place.tags.includes(selected))
	const markers = shown.map((place) => `<div class="qwerty-map-marker" data-latitude="${place.latitude}" data-longitude="${place.longitude}" data-label="${place.label}" data-modal-url="/${place.token}/modal"></div>`).join("")
	const source = stripComments(read(join(qwerty, "qwerty-collection/items-map.html")))

	// The markers replace the range over $places, which closes with its if's end and then its own
	const map = source.slice(source.indexOf(`<div class="qwerty-map `))
	const start = map.indexOf("{{- range $places -}}")
	const end = map.indexOf("{{- end -}}", map.indexOf("{{- end -}}", start) + 1) + "{{- end -}}".length
	const body = (map.slice(0, start) + markers + map.slice(end))
		.replace("{{$mapTiles.Href}}", "/tiles/{z}/{x}/{y}.png")
		.replace("{{$mapTiles.Description}}", "Tiles")
		.replace("{{if $location.HasGeocode}}{{$location.Latitude}}{{end}}", "")
		.replace("{{if $location.HasGeocode}}{{$location.Longitude}}{{end}}", "")
		.replace("{{.Data `zoom`}}", "")
		.replaceAll("{{$tag}}", selected)
		.replaceAll("{{.StreamID}}", "map")

	// A template change this copy cannot render fails here, not as a wrong map
	const action = body.match(/\{\{[^}]*\}\}/)
	if (action) {
		throw new Error(`items-map.html has an action mapTab does not render: ${action[0]}`)
	}
	return `<div id="profile-tabs"><div role="tablist" class="pills"><a role="tab" aria-selected="true">Map</a></div>${tagPills(selected, "map", "cartographer")}${body}</div>`
}

// mapRoute serves Leaflet's stylesheet, script, and marker images from Emissary's resources, and one gray tile for every map tile
function mapRoute(response, path) {

	const leafletPath = "/.themes/global/resources/leaflet-1.9.4/"
	if (path.startsWith(leafletPath)) {
		const file = join(templates, "theme-global/resources/leaflet-1.9.4", path.slice(leafletPath.length).replaceAll("..", ""))
		const types = { css: "text/css", js: "text/javascript", png: "image/png" }
		if (!existsSync(file)) {
			return false
		}
		response.writeHead(200, { "Content-Type": types[file.split(".").pop()] ?? "application/octet-stream" })
		response.end(readFileSync(file))
		return true
	}

	if (path.startsWith("/tiles/")) {
		response.writeHead(200, { "Content-Type": "image/png" })
		response.end(png(256, 256, [220, 220, 220]))
		return true
	}

	return false
}

// profileUsername is qwerty-outbox/profile-header.html's handle, whose Clipboard behavior copies the full @user@host
function profileUsername() {
	const block = stripComments(read(join(qwerty, "qwerty-outbox/profile-header.html"))).match(/<div id="profile-username"[\s\S]*?<\/div>/)[0]
	return icons(block.replaceAll("{{.Username}}", "author").replaceAll("{{.Hostname}}", "example.social"))
}

// page wraps a body in the shell, with the htmx-config meta that qwerty-theme/page.html carries, if it still does
function page(body) {
	return read(join(here, "fixtures/shell.html")).replace("${BODY}", body)
}

const routes = {
	"/healthz": () => ["text/plain", "ok"],
	"/css": () => ["text/css", [
		concat(join(templates, "theme-global/stylesheet")),
		concat(join(templates, "theme-default/stylesheet")),
		concat(join(qwerty, "qwerty-theme/stylesheet")),
		concat(join(qwerty, "qwerty-outbox/stylesheet")),
	].join("\n")],
	"/js/htmx.js": () => ["text/javascript", read(join(templates, "theme-global/resources/htmx-1.9.12/htmx.min.js"))],
	"/js/hyperscript.js": () => ["text/javascript", read(join(templates, "theme-global/resources/hyperscript-0.9.93/_hyperscript.min.js"))],
	"/js/global.js": () => ["text/javascript", concat(join(templates, "theme-global/javascript"))],
	"/hs/global.hs": () => ["text/hyperscript", concat(join(templates, "theme-global/hyperscript"))],
	"/js/podcast.js": () => ["text/javascript", concat(join(qwerty, "qwerty-theme/podcast"))],
	"/episode": () => ["text/html", page(`<aside>${episodeModal(0)}</aside>`)],
	"/entry": () => ["text/html", page(`<aside>${entryModal(0)}</aside>`)],
	"/podcast-list": () => ["text/html", page(read(join(here, "fixtures/podcast-list.html")).replace("${DATE}", dateCell()))],
	"/list": () => ["text/html", page(read(join(here, "fixtures/list.html")))],
	"/tabs": () => ["text/html", page(read(join(here, "fixtures/tabs.html")))],
	"/upload": () => ["text/html", page(read(join(here, "fixtures/upload.html")))],
	"/editorjs": () => ["text/html", page(visualEditor(join(qwerty, "qwerty-article/edit-content-editorjs.html")))],
	"/editorjs-emissary": () => ["text/html", page(visualEditor(join(templates, "stream-article-editorjs/editor.html")))],
	"/@author": () => ["text/html", page(`<div hx-target="main" hx-swap="innerHTML"><main>${profileArticles()}</main></div>`)],
	"/articles/list": () => ["text/html", profileArticles()],
	"/@photographer": () => ["text/html", page(`<main><div><div style="height: 300px">The profile's header</div>${galleryTab("")}</div></main>`)],
	"/gallery/list": (url) => ["text/html", galleryTab(url.searchParams.get("tag") || "")],
	"/@columnist": (url) => ["text/html", page(`<main><div><div style="height: 300px">The profile's header</div>${profileFrame(url.searchParams.get("tab") == "scrapbook" ? scrapbookTab() : essaysTab(url.searchParams.get("tag") || ""))}</div></main>`)],
	"/essays/list": (url) => ["text/html", essaysTab(url.searchParams.get("tag") || "")],
	"/scrapbook/list": () => ["text/html", scrapbookTab()],
	"/@cartographer": (url) => ["text/html", page(`<main><div><div style="height: 300px">The profile's header</div>${mapTab(url.searchParams.get("tag") || "")}</div></main>`)],
	"/map/list": (url) => ["text/html", mapTab(url.searchParams.get("tag") || "")],
	"/.themes/qwerty-theme/carousel": () => ["text/javascript", concat(join(qwerty, "qwerty-theme/carousel"))],
	"/.themes/qwerty-theme/podcast": () => ["text/javascript", concat(join(qwerty, "qwerty-theme/podcast"))],
	"/.themes/qwerty-theme/maps": () => ["text/javascript", concat(join(qwerty, "qwerty-theme/maps"))],
	"/handle": () => ["text/html", page(profileUsername())],
	...Object.fromEntries(articles.map((article) => [`/${article.token}`, () => ["text/html", `<h1>${article.title}</h1>`]])),
	...Object.fromEntries(essays.map((essay) => [`/${essay.token}`, () => ["text/html", `<h1>${essay.title}</h1>`]])),
}

createServer((request, response) => {
	const path = new URL(request.url, "http://x").pathname

	// The upload spec's images, Save, and delete
	if (await uploadRoute(request, response, path, url)) {
		return
	}

	// The bootstrap icons, as static files
	if (path.startsWith("/icons/")) {
		const file = join(templates, "theme-global/resources/bootstrap-icons-1.13.1", path.slice(7).replace(/\.\./g, ""))
		if (existsSync(file)) {
			response.writeHead(200, { "Content-Type": file.endsWith(".css") ? "text/css" : "font/woff2" })
			return response.end(readFileSync(file))
		}
	}

	// An episode's or an entry's modal, with the headers Emissary's as-modal sends
	const modal = path.match(/^\/([0-9a-f]{24})\/modal$/)
	if (modal) {
		const headers = { "Content-Type": "text/html", "HX-Retarget": "aside", "HX-Reswap": "innerHTML", "HX-Push-Url": "false" }
		const index = episodes.findIndex((episode) => episode.id == modal[1])
		if (index >= 0) {
			response.writeHead(200, headers)
			return response.end(episodeModal(index))
		}
		const entryIndex = entries.findIndex((entry) => entry.id == modal[1])
		if (entryIndex >= 0) {
			response.writeHead(200, headers)
			return response.end(entryModal(entryIndex))
		}
	}

	// Saving an episode answers as its edit action does: a 303 to its modal, with no closeModal event
	const save = path.match(/^\/([0-9a-f]{24})\/edit$/)
	if (save && request.method == "POST") {
		request.resume()
		response.writeHead(303, { "Location": `/${save[1]}/modal` })
		return response.end()
	}

	if (routes[path]) {
		const [type, body] = routes[path]()
		response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" })
		return response.end(body)
	}

	response.writeHead(404)
	response.end("not found")
}).listen(port, "127.0.0.1", () => console.log(`fixtures on http://127.0.0.1:${port}`))
