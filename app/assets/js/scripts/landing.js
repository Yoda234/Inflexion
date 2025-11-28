// Requirements
const { URL } = require('url')
const { MojangRestAPI, getServerStatus } = require('helios-core/mojang')
const { RestResponseStatus, isDisplayableError, validateLocalFile } = require('helios-core/common')
const { FullRepair, DistributionIndexProcessor, MojangIndexProcessor, downloadFile } = require('helios-core/dl')
const { validateSelectedJvm, ensureJavaDirIsRoot, javaExecFromRoot, discoverBestJvmInstallation, latestOpenJDK, extractJdk } = require('helios-core/java')
const DiscordWrapper = require('./assets/js/discordwrapper')
const ProcessBuilder = require('./assets/js/processbuilder')

// Elements
const launch_content = document.getElementById('launch_content')
const launch_details = document.getElementById('launch_details')
const launch_progress = document.getElementById('launch_progress')
const launch_progress_label = document.getElementById('launch_progress_label')
const launch_details_text = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const user_text = document.getElementById('user_text')
const loggerLanding = LoggerUtil.getLogger('Landing')

// --- FONCTION ESSENTIELLE POUR EVITER LE CRASH UICORE ---
function initNews() {
    console.log("News initialisées (Mode Custom HUD).");
}

function toggleLaunchArea(loading){
    if(loading){
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
    } else {
        launch_details.style.display = 'none'
        launch_content.style.display = 'inline-flex'
    }
}
function setLaunchDetails(details){ launch_details_text.innerHTML = details }
function setLaunchPercentage(percent){ launch_progress.setAttribute('max', 100); launch_progress.setAttribute('value', percent); launch_progress_label.innerHTML = percent + '%' }
function setDownloadPercentage(percent){ remote.getCurrentWindow().setProgressBar(percent/100); setLaunchPercentage(percent) }
function setLaunchEnabled(val){ document.getElementById('launch_button').disabled = !val }

// --- LOGIQUE BOUTON JOUER ---
document.getElementById('launch_button').addEventListener('click', async e => {
    // Animation
    const launchBtn = document.getElementById('launch_button')
    launchBtn.classList.add('is-launching')
    if (!launchBtn.getAttribute('data-original-text')) {
        launchBtn.setAttribute('data-original-text', launchBtn.innerHTML)
    }
    launchBtn.innerHTML = '<span>LANCEMENT...</span>'

    loggerLanding.info('Launching game..')
    
    // Vérification des Mods
    try {
        const serverId = ConfigManager.getSelectedServer()
        const distribution = await DistroAPI.getDistribution()
        const server = distribution.getServerById(serverId)
        const userConfig = ConfigManager.getModConfiguration(serverId)
        let hasOptionalModEnabled = false
        for (const mdl of server.modules) {
            const type = mdl.rawModule.type
            if (['ForgeMod', 'LiteMod', 'LiteLoader', 'FabricMod'].includes(type)) {
                if (!mdl.getRequired().value) {
                    const modId = mdl.getVersionlessMavenIdentifier()
                    let isEnabled = mdl.getRequired().def 
                    if (userConfig && userConfig.mods && userConfig.mods[modId] !== undefined) {
                        const savedState = userConfig.mods[modId]
                        if (typeof savedState === 'boolean') isEnabled = savedState
                        else if (typeof savedState === 'object') isEnabled = savedState.value
                    }
                    if (isEnabled) { hasOptionalModEnabled = true; break }
                }
            }
        }
        if (hasOptionalModEnabled) {
            showLaunchFailure('Lancement Interdit', 'Vous avez activé des mods optionnels. Veuillez les désactiver dans les paramètres.')
            return
        }
    } catch (err) { console.error("Erreur verif mods:", err) }

    // Lancement
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

// --- BOUTON PARAMÈTRES (CORRECTIF) ---
// On vérifie si le bouton existe avant d'ajouter l'événement pour éviter le crash
const settingsBtn = document.getElementById('settingsMediaButton');
if(settingsBtn) {
    settingsBtn.onclick = async e => { 
        await prepareSettings(); 
        switchView(getCurrentView(), VIEWS.settings); 
    }
}

// --- BOUTON AVATAR (SUPPRIMÉ) ---
// J'ai supprimé la ligne qui causait le crash (avatarOverlay.onclick) car le bouton n'existe plus.

function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    if(authUser != null){
        if(authUser.displayName != null) username = authUser.displayName
        if(authUser.uuid != null) document.getElementById('avatarContainer').style.backgroundImage = `url('https://mc-heads.net/body/${authUser.uuid}/right')`
    }
    user_text.innerHTML = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings) fullSettingsSave()
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()
    // Mise à jour simplifiée pour le nouveau design
    server_selection_button.innerHTML = (serv != null ? serv.rawServer.name : Lang.queryJS('landing.noSelection'))
    if(getCurrentView() === VIEWS.settings) animateSettingsTabRefresh()
    setLaunchEnabled(serv != null)
}

// Initialisation bouton serveur
if(server_selection_button) {
    server_selection_button.innerHTML = Lang.queryJS('landing.selectedServer.loading')
    server_selection_button.onclick = async e => { e.target.blur(); await toggleServerSelection(true) }
}

const refreshMojangStatuses = async function(){ }
const refreshServerStatus = async (fade = false) => {
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    let pLabel = Lang.queryJS('landing.serverStatus.server')
    let pVal = Lang.queryJS('landing.serverStatus.offline')
    try {
        const servStat = await getServerStatus(47, serv.hostname, serv.port)
        pLabel = Lang.queryJS('landing.serverStatus.players')
        pVal = servStat.players.online + '/' + servStat.players.max
    } catch (err) {}
    
    const statusWrapper = $('#server_status_wrapper')
    if(fade && statusWrapper.length){
        statusWrapper.fadeOut(250, () => {
            const labelEl = document.getElementById('landingPlayerLabel')
            const countEl = document.getElementById('player_count')
            if(labelEl) labelEl.innerHTML = pLabel
            if(countEl) countEl.innerHTML = pVal
            statusWrapper.fadeIn(500)
        })
    } else {
        const labelEl = document.getElementById('landingPlayerLabel')
        const countEl = document.getElementById('player_count')
        if(labelEl) labelEl.innerHTML = pLabel
        if(countEl) countEl.innerHTML = pVal
    }
}
refreshMojangStatuses()
let serverStatusListener = setInterval(() => refreshServerStatus(true), 300000)

function showLaunchFailure(title, desc){ 
    const launchBtn = document.getElementById('launch_button')
    if(launchBtn) {
        launchBtn.classList.remove('is-launching')
        if (launchBtn.getAttribute('data-original-text')) {
            launchBtn.innerHTML = launchBtn.getAttribute('data-original-text')
        }
    }
    setOverlayContent(title, desc, Lang.queryJS('landing.launch.okay')); 
    setOverlayHandler(null); 
    toggleOverlay(true); 
    toggleLaunchArea(false) 
}

async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){
    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)
    const jvmDetails = await discoverBestJvmInstallation(ConfigManager.getDataDirectory(), effectiveJavaOptions.supported)
    if(jvmDetails == null) {
        setOverlayContent(Lang.queryJS('landing.systemScan.noCompatibleJava'), Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }), Lang.queryJS('landing.systemScan.installJava'), Lang.queryJS('landing.systemScan.installJavaManually'))
        setOverlayHandler(() => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)
            try { downloadJava(effectiveJavaOptions, launchAfter) } catch(err) { showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText')) }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                setOverlayContent(Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }), Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }), Lang.queryJS('landing.systemScan.javaRequiredDismiss'), Lang.queryJS('landing.systemScan.javaRequiredCancel'))
                setOverlayHandler(() => { toggleLaunchArea(false); toggleOverlay(false) })
                setDismissHandler(() => { toggleOverlay(false, true); asyncSystemScan(effectiveJavaOptions, launchAfter) })
                $('#overlayContent').fadeIn(250)
            })
        })
        toggleOverlay(true, true)
    } else {
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()
        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)
        if(launchAfter){ await dlAsync() }
    }
}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {
    const asset = await latestOpenJDK(effectiveJavaOptions.suggestedMajor, ConfigManager.getDataDirectory(), effectiveJavaOptions.distribution)
    if(asset == null) throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)
    if(received != asset.size) {
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
    }
    remote.getCurrentWindow().setProgressBar(2)
    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => { if(dotStr.length >= 3) dotStr = ''; else dotStr += '.'; setLaunchDetails(eLStr + dotStr) }, 750)
    const newJavaExec = await extractJdk(asset.path)
    remote.getCurrentWindow().setProgressBar(-1)
    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()
    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))
    asyncSystemScan(effectiveJavaOptions, launchAfter)
}

let proc, hasRPC = false
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/
const MIN_LINGER = 5000

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
    setLaunchPercentage(0, 100)
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

// --- AUDIO MANAGER ---
document.addEventListener('DOMContentLoaded', () => {
    const musicBtn = document.getElementById('musicButton')
    const musicPlayer = document.getElementById('launcherMusic')
    const musicSVG = document.getElementById('musicSVG')
    const iconSoundOn = '<path d="M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77zM16.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM3 9v6h4l5 5V4L7 9H3z"/>'
    const iconSoundOff = '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>'
    
    // Ajout du volume
    if(musicPlayer) {
        musicPlayer.volume = 0.1;
    }

    let isMuted = false
    if(musicBtn && musicPlayer) {
        musicBtn.addEventListener('click', () => {
            if (isMuted) { musicPlayer.muted = false; musicSVG.innerHTML = iconSoundOn; musicSVG.style.fill = "#ffffff"; isMuted = false } 
            else { musicPlayer.muted = true; musicSVG.innerHTML = iconSoundOff; musicSVG.style.fill = "#ef4444"; isMuted = true }
        })
    }
})