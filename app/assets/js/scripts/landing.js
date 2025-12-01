// Requirements
const { URL } = require('url')
const { MojangRestAPI, getServerStatus } = require('helios-core/mojang')
const { RestResponseStatus, isDisplayableError, validateLocalFile } = require('helios-core/common')
const { FullRepair, DistributionIndexProcessor, MojangIndexProcessor, downloadFile } = require('helios-core/dl')
const { validateSelectedJvm, ensureJavaDirIsRoot, javaExecFromRoot, discoverBestJvmInstallation, latestOpenJDK, extractJdk } = require('helios-core/java')
const DiscordWrapper = require('./assets/js/discordwrapper')
const ProcessBuilder = require('./assets/js/processbuilder')
const fs = require('fs')
const { clipboard} = require('electron')

// --- CONFIGURATION ---
const NEWS_API_URL = "http://panel.infllexionhost.eu:25568/news.json";

// ATTENTION: J'ai remis HTTP ici car ton serveur rejette le HTTPS (Erreur SSL -107).
// Si tu es CERTAIN que ton serveur supporte le SSL, remets 'https', mais c'est la cause du bug actuel.
const SKIN_API_ENDPOINT = "htt://play.infllexionhost.eu/api.php"; 

const ADMIN_UUIDS = [
    "b87a8ce6a5f94ba682e2dce7b9927126",
    "9f02187146df48b79cc743abd82d02bd",
    "b5cbe6201cbf4f408f26c92ce8742f11"
];

// Elements UI
const launch_content = document.getElementById('launch_content')
const launch_details = document.getElementById('launch_details')
const launch_progress = document.getElementById('launch_progress')
const launch_progress_label = document.getElementById('launch_progress_label')
const launch_details_text = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const user_text = document.getElementById('user_text')
const user_rank = document.getElementById('user_rank')
const loggerLanding = LoggerUtil.getLogger('Landing')

// --- FONCTION ANTI-CRASH UIBINDER ---
async function initNews() {
    loadNewsInBackground(); 
    return Promise.resolve();
}

async function loadNewsInBackground() {
    const container = document.getElementById('newsListContent');
    if (!container) return;
    
    container.innerHTML = '<div style="padding:20px; color:#aaa; text-align:center;">Chargement...</div>';

    try {
        const response = await fetch(NEWS_API_URL);
        if(!response.ok) throw new Error("Erreur HTTP " + response.status);
        const newsData = await response.json();
        
        container.innerHTML = '';
        newsData.forEach(news => {
            const article = document.createElement('div');
            article.className = 'news-article';
            const imgUrl = news.image || '';

            article.innerHTML = `
                <div class="article-image" style="background-image: url('${imgUrl}');"></div>
                <div class="article-info">
                    <span class="article-date">${news.date}</span>
                    <h3 class="article-title">${news.title}</h3>
                    <p class="article-desc">${news.desc}</p>
                    ${news.link && news.link !== '#' ? `<a href="${news.link}" target="_blank" class="article-link">EN SAVOIR PLUS →</a>` : ''}
                </div>`;
            container.appendChild(article);
        });
    } catch (err) {
        console.warn("News error:", err);
        container.innerHTML = '<div style="padding:20px; color:#ef4444; text-align:center;">Actualités indisponibles.</div>';
    }
}

// =============================================================================
// --- SKIN MANAGER ---
// =============================================================================
let currentFolder = 'root';
let currentUserTarget = null;

function initSkinManager() {
    const account = ConfigManager.getSelectedAccount();
    if(!account) return;
    
    if(!currentUserTarget) currentUserTarget = account.uuid;

    // Admin Panel Check
    if (ADMIN_UUIDS.includes(account.uuid)) {
        const sBox = document.getElementById('adminSkinSearch');
        if(sBox) sBox.style.display = 'flex';
        
        const sBtn = document.getElementById('adminSearchBtn');
        if(sBtn) {
            sBtn.onclick = () => {
                const val = document.getElementById('adminSearchInput').value;
                if(val) { currentUserTarget = val; currentFolder = 'root'; refreshSkinView(); }
            };
        }
    }
    refreshSkinView();
    setupFileUploadZone();
}

/**
 * Rafraichit l'affichage (Grid + Dossiers)
 */
async function refreshSkinView() {
    const grid = document.getElementById('skinGrid');
    const folderList = document.getElementById('folderList');
    const msg = document.getElementById('emptySkinMessage');
    const pathLabel = document.getElementById('currentPathLabel');
    
    if(!grid) return;
    grid.innerHTML = '<div style="color:#aaa; width:100%; text-align:center; margin-top:50px;">Chargement...</div>';

    try {
        const url = `${SKIN_API_ENDPOINT}?action=list&uuid=${currentUserTarget}&folder=${currentFolder}&t=${Date.now()}`;
        const response = await fetch(url);
        if(!response.ok) throw new Error("Erreur Serveur");
        const data = await response.json();

        // 1. Génération Liste Dossiers (Avec Drop Zone)
        if(folderList) {
            let html = `
                <div class="folder-item ${currentFolder === 'root' ? 'active' : ''}" 
                     onclick="changeFolder('root')"
                     ondragover="allowDrop(event)"
                     ondrop="dropOnFolder(event, 'root')">
                     📁 Principal
                </div>`;
            
            if(data.folders) {
                data.folders.forEach(folder => {
                    html += `
                        <div class="folder-item ${currentFolder === folder ? 'active' : ''}"
                             ondragover="allowDrop(event)"
                             ondrop="dropOnFolder(event, '${folder}')">
                            <span class="folder-name-span" onclick="changeFolder('${folder}')">📁 ${folder}</span>
                            <span class="delete-folder-btn" onclick="deleteItem(event, '${folder}', 'folder')">×</span>
                        </div>`;
                });
            }
            folderList.innerHTML = html;
        }

        // 2. Génération Grille Skins (Avec Drag Source)
        grid.innerHTML = '';
        if(!data.skins || data.skins.length === 0) {
            if(msg) msg.style.display = 'block';
        } else {
            if(msg) msg.style.display = 'none';
            data.skins.forEach(skin => {
                // IMPORTANT: On utilise l'URL fournie par l'API sans forcer le HTTPS
                // car cela cause des erreurs ERR_SSL_PROTOCOL_ERROR si le serveur ne suit pas.
                const rawUrl = skin.url; 
                
                const el = document.createElement('div');
                el.className = 'skin-file';
                el.setAttribute('draggable', 'true');
                
                // Drag Events
                el.ondragstart = (e) => {
                    e.dataTransfer.setData("text/plain", skin.name);
                    e.dataTransfer.effectAllowed = "move";
                    el.style.opacity = "0.5";
                };
                el.ondragend = () => { el.style.opacity = "1"; };

                // Click (Preview)
                el.onclick = () => selectSkin(rawUrl, skin.name);

                el.innerHTML = `
                    <div class="skin-img-view" style="background-image: url('${rawUrl}')"></div>
                    <div class="skin-title">${skin.name}</div>
                    <div class="skin-actions-row">
                        <button class="skin-btn btn-copy-small" onclick="copyLinkSmall(event, '${rawUrl}')">COPIER</button>
                        <button class="skin-btn btn-del" onclick="deleteItem(event, '${skin.name}', 'file')">🗑</button>
                    </div>`;
                grid.appendChild(el);
            });
        }
        if(pathLabel) pathLabel.innerText = currentFolder === 'root' ? '/' : '/' + currentFolder;

    } catch(e) {
        console.error(e);
        grid.innerHTML = '<div style="color:#ef4444; text-align:center; margin-top:20px;">Impossible de charger les skins.<br>Vérifiez la connexion API.</div>';
    }
}

// --- GLOBAL WINDOW FUNCTIONS ---

window.changeFolder = (folder) => {
    currentFolder = folder;
    const preview = document.getElementById('skinPreviewHeader');
    if(preview) preview.style.display = 'none';
    refreshSkinView();
}

window.deleteItem = async (event, name, type) => {
    event.stopPropagation();
    if(confirm(`Supprimer "${name}" ?`)) {
        const formData = new FormData();
        formData.append('action', 'delete');
        formData.append('uuid', currentUserTarget);
        formData.append('folder', currentFolder);
        formData.append('name', name);
        formData.append('type', type);

        try { 
            await fetch(SKIN_API_ENDPOINT, { method: 'POST', body: formData });
            refreshSkinView(); 
        } catch(e) { alert("Erreur lors de la suppression."); }
    }
}

window.selectSkin = (url, name) => {
    const header = document.getElementById('skinPreviewHeader');
    const img = document.getElementById('previewImageBig');
    const title = document.getElementById('previewName');
    const input = document.getElementById('previewUrlInput');
    const copyBtn = document.getElementById('previewCopyBtn');
    const dim = document.getElementById('previewDimensions');

    if(header) {
        header.style.display = 'flex';
        if(img) img.src = url;
        if(title) title.innerText = name;
        if(input) input.value = url;
        
        if(dim) dim.innerText = "...";
        if(img) img.onload = function() { if(dim) dim.innerText = `${this.naturalWidth}x${this.naturalHeight}px`; }

        if(copyBtn) {
            copyBtn.onclick = () => {
                clipboard.writeText(url);
                copyBtn.innerText = "COPIÉ !";
                setTimeout(() => copyBtn.innerText = "COPIER LE LIEN", 2000);
            };
        }
    }
}

window.copyLinkSmall = (event, url) => {
    event.stopPropagation();
    clipboard.writeText(url);
    alert("Lien copié !");
}

// DRAG & DROP : DÉPLACEMENT
window.allowDrop = (event) => {
    event.preventDefault();
    event.currentTarget.style.background = "rgba(59, 130, 246, 0.3)";
}

window.dropOnFolder = async (event, targetFolder) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.style.background = "";
    
    const fileName = event.dataTransfer.getData("text/plain");
    
    if (targetFolder === currentFolder) return;

    if(confirm(`Déplacer "${fileName}" vers "${targetFolder === 'root' ? 'Principal' : targetFolder}" ?`)) {
        const formData = new FormData();
        formData.append('action', 'move');
        formData.append('uuid', currentUserTarget);
        formData.append('file', fileName);
        formData.append('old_folder', currentFolder);
        formData.append('new_folder', targetFolder);

        try {
            await fetch(SKIN_API_ENDPOINT, { method: 'POST', body: formData });
            refreshSkinView();
        } catch(e) {
            alert("Erreur lors du déplacement.");
        }
    }
}

// --- UPLOAD FICHIER ---
function setupFileUploadZone() {
    const uploadBtn = document.getElementById('uploadSkinBtn');
    if(uploadBtn) {
        uploadBtn.onclick = () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.png';
            input.onchange = async e => {
                if(e.target.files[0]) uploadFile(e.target.files[0]);
            }
            input.click();
        }
    }

    const zone = document.getElementById('skinDropZone');
    if(zone) {
        zone.ondragover = (e) => { 
            e.preventDefault(); 
            if(!e.dataTransfer.getData("text/plain")) {
                zone.classList.add('drag-over'); 
            }
        };
        zone.ondragleave = () => zone.classList.remove('drag-over');
        zone.ondrop = (e) => {
            e.preventDefault(); 
            zone.classList.remove('drag-over');
            if(e.dataTransfer.files.length > 0) {
                uploadFile(e.dataTransfer.files[0]);
            }
        };
    }
}

async function uploadFile(file) {
    if(file.type !== 'image/png') {
        alert("Seuls les fichiers PNG sont autorisés.");
        return;
    }
    const formData = new FormData();
    formData.append('action', 'upload');
    formData.append('uuid', currentUserTarget);
    formData.append('folder', currentFolder);
    formData.append('file', file);
    
    try {
        await fetch(SKIN_API_ENDPOINT, { method: 'POST', body: formData });
        refreshSkinView();
    } catch(err) { alert("Erreur upload"); }
}

// --- CRÉATION DE DOSSIER ---
const createFolderBtn = document.getElementById('createFolderBtn');
const folderOverlay = document.getElementById('createFolderOverlay');
const folderInput = document.getElementById('newFolderInput');
const confirmFolder = document.getElementById('confirmFolderBtn');
const cancelFolder = document.getElementById('cancelFolderBtn');

if(createFolderBtn && folderOverlay) {
    createFolderBtn.onclick = () => {
        folderOverlay.style.display = 'flex';
        if(folderInput) { 
            folderInput.value = ''; 
            setTimeout(() => { folderOverlay.classList.add('active'); folderInput.focus(); }, 10); 
        }
    };

    const doCreateFolder = async () => {
        const name = folderInput.value.trim();
        if(name) {
            folderOverlay.classList.remove('active');
            setTimeout(() => folderOverlay.style.display = 'none', 200);
            
            const formData = new FormData();
            formData.append('action', 'create_folder');
            formData.append('uuid', currentUserTarget);
            formData.append('new_folder_name', name);
            try { await fetch(SKIN_API_ENDPOINT, { method: 'POST', body: formData }); refreshSkinView(); } 
            catch(e) { alert("Erreur création dossier"); }
        }
    };

    if(confirmFolder) confirmFolder.onclick = doCreateFolder;
    if(cancelFolder) cancelFolder.onclick = () => {
        folderOverlay.classList.remove('active');
        setTimeout(() => folderOverlay.style.display = 'none', 200);
    };
    if(folderInput) {
        folderInput.onkeydown = (e) => {
            if(e.key === 'Enter') doCreateFolder();
            if(e.key === 'Escape') cancelFolder.click();
        };
    }
}

// UI LAUNCHER CORE
function toggleLaunchArea(loading){
    if(loading){
        if(launch_details) launch_details.style.display = 'flex'
        if(launch_content) launch_content.style.display = 'none'
    } else {
        if(launch_details) launch_details.style.display = 'none'
        if(launch_content) launch_content.style.display = 'inline-flex'
    }
}
function setLaunchDetails(details){ if(launch_details_text) launch_details_text.innerHTML = details }
function setLaunchPercentage(percent){ 
    if(launch_progress) {
        launch_progress.setAttribute('max', 100); 
        launch_progress.setAttribute('value', percent);
    }
    if(launch_progress_label) launch_progress_label.innerHTML = percent + '%' 
}
function setDownloadPercentage(percent){ 
    remote.getCurrentWindow().setProgressBar(percent/100); 
    setLaunchPercentage(percent) 
}
function setLaunchEnabled(val){ 
    const btn = document.getElementById('launch_button');
    if(btn) btn.disabled = !val 
}

const launchBtnElement = document.getElementById('launch_button');
if(launchBtnElement){
    launchBtnElement.addEventListener('click', async e => {
        const launchBtn = document.getElementById('launch_button')
        launchBtn.classList.add('is-launching')
        if (!launchBtn.getAttribute('data-original-text')) {
            launchBtn.setAttribute('data-original-text', launchBtn.innerHTML)
        }
        launchBtn.innerHTML = '<span>LANCEMENT...</span>'
        setTimeout(() => {
            launchBtn.classList.remove('is-launching')
            if (launchBtn.getAttribute('data-original-text')) {
                launchBtn.innerHTML = launchBtn.getAttribute('data-original-text')
            }
        }, 30000)
        loggerLanding.info('Launching game..')
        try {
            const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
            const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
            if(jExe == null){ await asyncSystemScan(server.effectiveJavaOptions) } else {
                setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
                toggleLaunchArea(true)
                setLaunchPercentage(0, 100)
                const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
                if(details != null){ await dlAsync() } else { await asyncSystemScan(server.effectiveJavaOptions) }
            }
        } catch(err) {
            loggerLanding.error('Unhandled error', err)
            showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
        }
    })
}

const settingsBtn = document.getElementById('settingsMediaButton');
if(settingsBtn) {
    settingsBtn.onclick = async e => { 
        await prepareSettings(); 
        switchView(getCurrentView(), VIEWS.settings); 
    }
}

function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    const rk = document.getElementById('user_rank');
    const av = document.getElementById('avatarContainer');
    if(rk) { rk.className = ''; rk.innerHTML = ''; }
    if(authUser != null){
        if(authUser.displayName != null) username = authUser.displayName
        if(authUser.uuid != null && av) av.style.backgroundImage = `url('https://mc-heads.net/body/${authUser.uuid}/right')`
        if(rk) {
            if (ADMIN_UUIDS.includes(authUser.uuid)) {
                rk.innerHTML = "RANK : ADMIN"; rk.classList.add('rank-admin');
            } else {
                rk.innerHTML = "RANK : JOUEUR"; rk.classList.add('rank-player');
            }
        }
    }
    if(user_text) user_text.innerHTML = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings) fullSettingsSave()
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    const sb = document.getElementById('server_selection_button');
    if(sb){
        const span = sb.querySelector('.server-text');
        const txt = (serv != null ? serv.rawServer.name : Lang.queryJS('landing.noSelection'));
        if(span) span.innerHTML = txt; else sb.innerHTML = txt;
    }
    if(getCurrentView() === VIEWS.settings) animateSettingsTabRefresh()
    setLaunchEnabled(serv != null)
}

if(server_selection_button) {
    const span = server_selection_button.querySelector('.server-text');
    if(span) span.innerHTML = Lang.queryJS('landing.selectedServer.loading');
    server_selection_button.onclick = async e => { e.target.blur(); await toggleServerSelection(true) }
}

const serverBtnBottom = document.getElementById('serverSelectBtnBottom');
if(serverBtnBottom) {
    serverBtnBottom.addEventListener('click', async (e) => {
        e.target.blur(); 
        await toggleServerSelection(true);
    });
}

const newsBtn = document.getElementById('newsButton');
const newsOverlay = document.getElementById('newsOverlay');
const closeNews = document.getElementById('closeNewsBtn');
const skinBtn = document.getElementById('skinManagerBtn');
const skinOverlay = document.getElementById('skinOverlay');
const closeSkin = document.getElementById('closeSkinBtn');

function openOverlay(overlay, cb) {
    if(cb) cb();
    overlay.style.display = 'flex';
    setTimeout(() => overlay.classList.add('active'), 10);
}
function closeOverlay(overlay) {
    overlay.classList.remove('active');
    setTimeout(() => overlay.style.display = 'none', 300);
}

if (newsBtn && newsOverlay) {
    newsBtn.onclick = () => openOverlay(newsOverlay, initNews);
    if(closeNews) closeNews.onclick = () => closeOverlay(newsOverlay);
}

if (skinBtn && skinOverlay) {
    skinBtn.onclick = () => openOverlay(skinOverlay, initSkinManager);
    if(closeSkin) closeSkin.onclick = () => closeOverlay(skinOverlay);
}

window.onclick = function(event) {
    if (event.target == newsOverlay) closeOverlay(newsOverlay);
    if (event.target == skinOverlay) closeOverlay(skinOverlay);
}

document.addEventListener('DOMContentLoaded', () => {
    const win = remote.getCurrentWindow();
    const btnMin = document.getElementById('frameButton_minimize');
    if(btnMin) btnMin.onclick = () => win.minimize();
    const btnMax = document.getElementById('frameButton_restoredown');
    if(btnMax) btnMax.onclick = () => { if(win.isMaximized()) win.unmaximize(); else win.maximize(); };
    const btnClose = document.getElementById('frameButton_close');
    if(btnClose) btnClose.onclick = () => win.close();
    const sideClose = document.getElementById('closeLauncherBtn');
    if(sideClose) sideClose.onclick = () => win.close();

    const musicBtn = document.getElementById('musicButton')
    const musicPlayer = document.getElementById('launcherMusic')
    const musicSVG = document.querySelector('#musicButton .mediaSVG')
    const iconSoundOn = '<path fill="currentColor" d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77zM16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM3 9v6h4l5 5V4L7 9H3z"/>'
    const iconSoundOff = '<path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>'
    
    if(musicPlayer) musicPlayer.volume = 0.1;
    let isMuted = false
    if(musicBtn && musicPlayer) {
        musicBtn.addEventListener('click', () => {
            if (isMuted) { 
                musicPlayer.muted = false; 
                if(musicSVG) { musicSVG.innerHTML = iconSoundOn; musicSVG.style.fill = "white"; }
                isMuted = false 
            } else { 
                musicPlayer.muted = true; 
                if(musicSVG) { musicSVG.innerHTML = iconSoundOff; musicSVG.style.fill = "#ef4444"; }
                isMuted = true 
            }
        })
    }
})

// =============================================================================
// FONCTION INSTALLATION JAVA (MODE HARDCORE / SANS DISTRIBUTION)
// =============================================================================

async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){
    
    // --- CONFIGURATION JAVA FORCÉE ---
    // On s'en fout de la distribution, on met les infos ici en dur.
    const forceJava = {
        suggestedMajor: 17,
        supported: 17,
        download: {
            // Ton lien direct vers le ZIP (pas l'exe)
            url: "https://play.infllexionhost.eu/download/java17.zip",
            
            // ⚠️ OBLIGATOIRE : La taille exacte du fichier en octets (Clic droit -> Propriétés)
            size: 190000000, 
            
            // ⚠️ OBLIGATOIRE : Le hash SHA-1 du fichier (utilise un site comme onlinemd5.com)
            hash: "METTRE_LE_SHA1_ICI"
        }
    };
    // ----------------------------------

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0)
    
    // On vérifie si Java est déjà là
    const jvmDetails = await discoverBestJvmInstallation(ConfigManager.getDataDirectory(), forceJava.supported)
    
    if(jvmDetails == null) {
        
        // Popup stylisée pour demander l'installation
        setOverlayContent(
            "JAVA REQUIS", 
            "Composant manquant détecté. Cliquez ci-dessous pour installer les fichiers nécessaires automatiquement.", 
            "INSTALLER (CLIC ICI)", 
            "Fermer"
        )
        
        setOverlayHandler(() => {
            setLaunchDetails("Téléchargement des composants...")
            toggleOverlay(false)
            
            try { 
                // ON LANCE LE TÉLÉCHARGEMENT AVEC NOS INFOS FORCÉES
                downloadJava(forceJava, launchAfter) 
            } catch(err) { 
                showLaunchFailure("Erreur", "Le téléchargement a échoué.") 
            }
        })
        
        setDismissHandler(() => {
            toggleOverlay(false)
            toggleLaunchArea(false)
        })
        
        toggleOverlay(true, true)
        
    } else {
        // Java est trouvé, on l'enregistre et on lance le jeu
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()
        if(launchAfter){ await dlAsync() }
    }
}
// =============================================================================
// --- SYSTÈME DE MISE À JOUR CUSTOM (CHECKER) ---
// =============================================================================

// CONFIGURATION UPDATE
// METTRE ICI L'URL DE TON FICHIER JSON SUR TON SITE WEB
const UPDATE_JSON_URL = "https://play.infllexionhost.eu/launcher_update.json"; 

// Fonction appelée au chargement
document.addEventListener('DOMContentLoaded', () => {
    checkForLauncherUpdate();
});

async function checkForLauncherUpdate() {
    try {
        // 1. Récupérer la version actuelle du launcher
        const currentVersion = remote.app.getVersion();
        console.log("Version actuelle : " + currentVersion);

        // 2. Récupérer le fichier JSON distant
        // Ajout d'un timestamp pour éviter le cache (?t=...)
        const response = await fetch(`${UPDATE_JSON_URL}?t=${Date.now()}`);
        if(!response.ok) return; // Si le fichier n'existe pas, on ignore

        const updateData = await response.json();
        
        // 3. Comparaison simple (Si version distante != version actuelle)
        // Pour être plus précis, on pourrait utiliser 'semver', mais ça suffit généralement.
        if (updateData.version !== currentVersion) {
            console.log("Mise à jour trouvée : " + updateData.version);
            showUpdateUI(updateData, currentVersion);
        } else {
            console.log("Launcher à jour.");
        }

    } catch (err) {
        console.warn("Impossible de vérifier les mises à jour launcher", err);
    }
}

function showUpdateUI(data, currentVer) {
    const overlay = document.getElementById('updateOverlay');
    const versionSpan = document.getElementById('newVersionSpan');
    const notesText = document.getElementById('updateNotesText');
    const btnDownload = document.getElementById('btnUpdateDownload');
    const btnIgnore = document.getElementById('btnUpdateIgnore');

    // Remplir les infos
    if(versionSpan) versionSpan.innerText = data.version;
    if(notesText) notesText.innerText = data.notes || "Mise à jour de maintenance.";

    // Afficher l'overlay
    if(overlay) {
        overlay.style.display = 'flex';
        setTimeout(() => overlay.classList.add('active'), 10);
    }

    // Action Télécharger
    if(btnDownload) {
        btnDownload.onclick = () => {
            // Ouvrir le lien dans le navigateur par défaut
            const { shell } = require('electron');
            shell.openExternal(data.url);
            // Fermer le launcher pour permettre l'installation
            setTimeout(() => {
                remote.app.quit();
            }, 1000);
        };
    }

    // Action Ignorer (Seulement si pas obligatoire)
    if(btnIgnore) {
        if(data.mandatory) {
            btnIgnore.style.display = 'none'; // On cache le bouton si obligatoire
            btnDownload.style.width = "100%"; // Le bouton télécharger prend toute la place
        } else {
            btnIgnore.onclick = () => {
                overlay.classList.remove('active');
                setTimeout(() => overlay.style.display = 'none', 300);
            };
        }
    }
}
async function dlAsync(login = true) {
    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))
    let distro
    try { distro = await DistroAPI.refreshDistributionOrFallback(); onDistroRefresh(distro) } catch(err) {
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }
    const serv = distro.getServerById(ConfigManager.getSelectedServer())
    if(login) { if(ConfigManager.getSelectedAccount() == null){ loggerLanding.error('You must be logged into an account.'); return } }
    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0)
    
    const fullRepairModule = new FullRepair(ConfigManager.getCommonDirectory(), ConfigManager.getInstanceDirectory(), ConfigManager.getLauncherDirectory(), ConfigManager.getSelectedServer(), DistroAPI.isDevMode())
    fullRepairModule.spawnReceiver()
    fullRepairModule.childProcess.on('error', (err) => { showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.errorDuringLaunchText')) })
    fullRepairModule.childProcess.on('close', (code, _signal) => { if(code !== 0){ showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails')) } })
    
    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    try { invalidFileCount = await fullRepairModule.verifyFiles(percent => { setLaunchPercentage(percent) }); setLaunchPercentage(100) } catch (err) {
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails')); return
    }
    
    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try { await fullRepairModule.download(percent => { setDownloadPercentage(percent) }); setDownloadPercentage(100) } catch(err) {
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails')); return
        }
    }
    
    remote.getCurrentWindow().setProgressBar(-1)
    fullRepairModule.destroyReceiver()
    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))
    const mojangIndexProcessor = new MojangIndexProcessor(ConfigManager.getCommonDirectory(), serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(ConfigManager.getCommonDirectory(), distro, serv.rawServer.id)
    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()
    if(login) {
        const authUser = ConfigManager.getSelectedAccount()
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))
        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)
        const onLoadComplete = () => {
            toggleLaunchArea(false)
            if(hasRPC){ DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading')); proc.stdout.on('data', gameStateChange) }
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)
        }
        const start = Date.now()
        const tempListener = function(data){ if(GAME_LAUNCH_REGEX.test(data.trim())){ const diff = Date.now()-start; if(diff < MIN_LINGER) { setTimeout(onLoadComplete, MIN_LINGER-diff) } else { onLoadComplete() } } }
        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){ DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined')) } 
            else if(GAME_JOINED_REGEX.test(data)){ DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining')) }
        }
        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){ showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded')) }
        }
        try {
            proc = pb.build()
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)
            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))
            if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
                proc.on('close', (code, signal) => { DiscordWrapper.shutdownRPC(); hasRPC = false; proc = null })
            }
        } catch(err) { showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails')) }
    }
}