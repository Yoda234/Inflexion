// Requirements
const os     = require('os')
const semver = require('semver')
const DropinModUtil  = require('./assets/js/dropinmodutil')
const { MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR } = require('./assets/js/ipcconstants')

const settingsState = {
    invalid: new Set()
}

function bindSettingsSelect(){
    for(let ele of document.getElementsByClassName('settingsSelectContainer')) {
        const selectedDiv = ele.getElementsByClassName('settingsSelectSelected')[0]

        selectedDiv.onclick = (e) => {
            e.stopPropagation()
            closeSettingsSelect(e.target)
            e.target.nextElementSibling.toggleAttribute('hidden')
            e.target.classList.toggle('select-arrow-active')
        }
    }
}

function closeSettingsSelect(el){
    for(let ele of document.getElementsByClassName('settingsSelectContainer')) {
        const selectedDiv = ele.getElementsByClassName('settingsSelectSelected')[0]
        const optionsDiv = ele.getElementsByClassName('settingsSelectOptions')[0]

        if(!(selectedDiv === el)) {
            selectedDiv.classList.remove('select-arrow-active')
            optionsDiv.setAttribute('hidden', '')
        }
    }
}

document.addEventListener('click', closeSettingsSelect)
bindSettingsSelect()

function bindFileSelectors(){
    for(let ele of document.getElementsByClassName('settingsFileSelButton')){
        
        ele.onclick = async e => {
            const isJavaExecSel = ele.id === 'settingsJavaExecSel'
            const directoryDialog = ele.hasAttribute('dialogDirectory') && ele.getAttribute('dialogDirectory') == 'true'
            const properties = directoryDialog ? ['openDirectory', 'createDirectory'] : ['openFile']

            const options = {
                properties
            }

            if(ele.hasAttribute('dialogTitle')) {
                options.title = ele.getAttribute('dialogTitle')
            }

            if(isJavaExecSel && process.platform === 'win32') {
                options.filters = [
                    { name: Lang.queryJS('settings.fileSelectors.executables'), extensions: ['exe'] },
                    { name: Lang.queryJS('settings.fileSelectors.allFiles'), extensions: ['*'] }
                ]
            }

            const res = await remote.dialog.showOpenDialog(remote.getCurrentWindow(), options)
            if(!res.canceled) {
                ele.previousElementSibling.value = res.filePaths[0]
                if(isJavaExecSel) {
                    await populateJavaExecDetails(ele.previousElementSibling.value)
                }
            }
        }
    }
}

bindFileSelectors()

function initSettingsValidators(){
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')
    Array.from(sEls).map((v, index, arr) => {
        const vFn = ConfigManager['validate' + v.getAttribute('cValue')]
        if(typeof vFn === 'function'){
            if(v.tagName === 'INPUT'){
                if(v.type === 'number' || v.type === 'text'){
                    v.addEventListener('keyup', (e) => {
                        const v = e.target
                        if(!vFn(v.value)){
                            settingsState.invalid.add(v.id)
                            v.setAttribute('error', '')
                            settingsSaveDisabled(true)
                        } else {
                            if(v.hasAttribute('error')){
                                v.removeAttribute('error')
                                settingsState.invalid.delete(v.id)
                                if(settingsState.invalid.size === 0){
                                    settingsSaveDisabled(false)
                                }
                            }
                        }
                    })
                }
            }
        }

    })
}

async function initSettingsValues(){
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')

    for(const v of sEls) {
        const cVal = v.getAttribute('cValue')
        const serverDependent = v.hasAttribute('serverDependent')
        const gFn = ConfigManager['get' + cVal]
        const gFnOpts = []
        if(serverDependent) {
            gFnOpts.push(ConfigManager.getSelectedServer())
        }
        if(typeof gFn === 'function'){
            if(v.tagName === 'INPUT'){
                if(v.type === 'number' || v.type === 'text'){
                    if(cVal === 'JavaExecutable'){
                        v.value = gFn.apply(null, gFnOpts)
                        await populateJavaExecDetails(v.value)
                    } else if (cVal === 'DataDirectory'){
                        v.value = gFn.apply(null, gFnOpts)
                    } else if(cVal === 'JVMOptions'){
                        v.value = gFn.apply(null, gFnOpts).join(' ')
                    } else {
                        v.value = gFn.apply(null, gFnOpts)
                    }
                } else if(v.type === 'checkbox'){
                    v.checked = gFn.apply(null, gFnOpts)
                }
            } else if(v.tagName === 'DIV'){
                if(v.classList.contains('rangeSlider')){
                    if(cVal === 'MinRAM' || cVal === 'MaxRAM'){
                        let val = gFn.apply(null, gFnOpts)
                        if(val.endsWith('M')){
                            val = Number(val.substring(0, val.length-1))/1024
                        } else {
                            val = Number.parseFloat(val)
                        }

                        v.setAttribute('value', val)
                    } else {
                        v.setAttribute('value', Number.parseFloat(gFn.apply(null, gFnOpts)))
                    }
                }
            }
        }
    }
}

function saveSettingsValues(){
    const sEls = document.getElementById('settingsContainer').querySelectorAll('[cValue]')
    Array.from(sEls).map((v, index, arr) => {
        const cVal = v.getAttribute('cValue')
        const serverDependent = v.hasAttribute('serverDependent')
        const sFn = ConfigManager['set' + cVal]
        const sFnOpts = []
        if(serverDependent) {
            sFnOpts.push(ConfigManager.getSelectedServer())
        }
        if(typeof sFn === 'function'){
            if(v.tagName === 'INPUT'){
                if(v.type === 'number' || v.type === 'text'){
                    if(cVal === 'JVMOptions'){
                        if(!v.value.trim()) {
                            sFnOpts.push([])
                            sFn.apply(null, sFnOpts)
                        } else {
                            sFnOpts.push(v.value.trim().split(/\s+/))
                            sFn.apply(null, sFnOpts)
                        }
                    } else {
                        sFnOpts.push(v.value)
                        sFn.apply(null, sFnOpts)
                    }
                } else if(v.type === 'checkbox'){
                    sFnOpts.push(v.checked)
                    sFn.apply(null, sFnOpts)
                    if(cVal === 'AllowPrerelease'){
                        changeAllowPrerelease(v.checked)
                    }
                }
            } else if(v.tagName === 'DIV'){
                if(v.classList.contains('rangeSlider')){
                    if(cVal === 'MinRAM' || cVal === 'MaxRAM'){
                        let val = Number(v.getAttribute('value'))
                        if(val%1 > 0){
                            val = val*1024 + 'M'
                        } else {
                            val = val + 'G'
                        }

                        sFnOpts.push(val)
                        sFn.apply(null, sFnOpts)
                    } else {
                        sFnOpts.push(v.getAttribute('value'))
                        sFn.apply(null, sFnOpts)
                    }
                }
            }
        }
    })
}

let selectedSettingsTab = 'settingsTabAccount'

function settingsTabScrollListener(e){
    if(e.target.scrollTop > Number.parseFloat(getComputedStyle(e.target.firstElementChild).marginTop)){
        document.getElementById('settingsContainer').setAttribute('scrolled', '')
    } else {
        document.getElementById('settingsContainer').removeAttribute('scrolled')
    }
}

function setupSettingsTabs(){
    Array.from(document.getElementsByClassName('settingsNavItem')).map((val) => {
        if(val.hasAttribute('rSc')){
            val.onclick = () => {
                settingsNavItemListener(val)
            }
        }
    })
}

function settingsNavItemListener(ele, fade = true){
    if(ele.hasAttribute('selected')){
        return
    }
    const navItems = document.getElementsByClassName('settingsNavItem')
    for(let i=0; i<navItems.length; i++){
        if(navItems[i].hasAttribute('selected')){
            navItems[i].removeAttribute('selected')
        }
    }
    ele.setAttribute('selected', '')
    let prevTab = selectedSettingsTab
    selectedSettingsTab = ele.getAttribute('rSc')

    document.getElementById(prevTab).onscroll = null
    document.getElementById(selectedSettingsTab).onscroll = settingsTabScrollListener

    if(fade){
        $(`#${prevTab}`).fadeOut(250, () => {
            $(`#${selectedSettingsTab}`).fadeIn({
                duration: 250,
                start: () => {
                    settingsTabScrollListener({
                        target: document.getElementById(selectedSettingsTab)
                    })
                }
            })
        })
    } else {
        $(`#${prevTab}`).hide(0, () => {
            $(`#${selectedSettingsTab}`).show({
                duration: 0,
                start: () => {
                    settingsTabScrollListener({
                        target: document.getElementById(selectedSettingsTab)
                    })
                }
            })
        })
    }
}

const settingsNavDone = document.getElementById('settingsNavDone')

function settingsSaveDisabled(v){
    settingsNavDone.disabled = v
}

function fullSettingsSave() {
    saveSettingsValues()
    saveModConfiguration()
    ConfigManager.save()
    saveShaderpackSettings()
}

settingsNavDone.onclick = () => {
    fullSettingsSave()
    switchView(getCurrentView(), VIEWS.landing)
}

/* Account Management Tab */

const msftLoginLogger = LoggerUtil.getLogger('Microsoft Login')
const msftLogoutLogger = LoggerUtil.getLogger('Microsoft Logout')

document.getElementById('settingsAddMojangAccount').onclick = (e) => {
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        loginViewOnCancel = VIEWS.settings
        loginViewOnSuccess = VIEWS.settings
        loginCancelEnabled(true)
    })
}

document.getElementById('settingsAddMicrosoftAccount').onclick = (e) => {
    switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
        ipcRenderer.send(MSFT_OPCODE.OPEN_LOGIN, VIEWS.settings, VIEWS.settings)
    })
}

ipcRenderer.on(MSFT_OPCODE.REPLY_LOGIN, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {
        const viewOnClose = arguments_[2]
        switchView(getCurrentView(), viewOnClose, 500, 500, () => {
            if(arguments_[1] === MSFT_ERROR.NOT_FINISHED) return
            setOverlayContent(
                Lang.queryJS('settings.msftLogin.errorTitle'),
                Lang.queryJS('settings.msftLogin.errorMessage'),
                Lang.queryJS('settings.msftLogin.okButton')
            )
            setOverlayHandler(() => { toggleOverlay(false) })
            toggleOverlay(true)
        })
    } else if(arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
        const queryMap = arguments_[1]
        const viewOnClose = arguments_[2]
        if (Object.prototype.hasOwnProperty.call(queryMap, 'error')) {
            switchView(getCurrentView(), viewOnClose, 500, 500, () => {
                let error = queryMap.error
                let errorDesc = queryMap.error_description
                setOverlayContent(error, errorDesc, Lang.queryJS('settings.msftLogin.okButton'))
                setOverlayHandler(() => { toggleOverlay(false) })
                toggleOverlay(true)
            })
        } else {
            const authCode = queryMap.code
            AuthManager.addMicrosoftAccount(authCode).then(value => {
                updateSelectedAccount(value)
                switchView(getCurrentView(), viewOnClose, 500, 500, async () => {
                    await prepareSettings()
                })
            }).catch((displayableError) => {
                let actualDisplayableError = isDisplayableError(displayableError) ? displayableError : Lang.queryJS('login.error.unknown')
                switchView(getCurrentView(), viewOnClose, 500, 500, () => {
                    setOverlayContent(actualDisplayableError.title, actualDisplayableError.desc, Lang.queryJS('login.tryAgain'))
                    setOverlayHandler(() => { toggleOverlay(false) })
                    toggleOverlay(true)
                })
            })
        }
    }
})

function bindAuthAccountSelect(){
    Array.from(document.getElementsByClassName('settingsAuthAccountSelect')).map((val) => {
        val.onclick = (e) => {
            if(val.hasAttribute('selected')) return
            Array.from(document.getElementsByClassName('settingsAuthAccountSelect')).forEach(btn => {
                btn.removeAttribute('selected')
                btn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectButton')
            })
            val.setAttribute('selected', '')
            val.innerHTML = Lang.queryJS('settings.authAccountSelect.selectedButton')
            setSelectedAccount(val.closest('.settingsAuthAccount').getAttribute('uuid'))
        }
    })
}

function bindAuthAccountLogOut(){
    Array.from(document.getElementsByClassName('settingsAuthAccountLogOut')).map((val) => {
        val.onclick = (e) => {
            let isLastAccount = false
            if(Object.keys(ConfigManager.getAuthAccounts()).length === 1){
                isLastAccount = true
                setOverlayContent(
                    Lang.queryJS('settings.authAccountLogout.lastAccountWarningTitle'),
                    Lang.queryJS('settings.authAccountLogout.lastAccountWarningMessage'),
                    Lang.queryJS('settings.authAccountLogout.confirmButton'),
                    Lang.queryJS('settings.authAccountLogout.cancelButton')
                )
                setOverlayHandler(() => {
                    processLogOut(val, isLastAccount)
                    toggleOverlay(false)
                })
                setDismissHandler(() => { toggleOverlay(false) })
                toggleOverlay(true, true)
            } else {
                processLogOut(val, isLastAccount)
            }
        }
    })
}

let msAccDomElementCache
function processLogOut(val, isLastAccount){
    const parent = val.closest('.settingsAuthAccount')
    const uuid = parent.getAttribute('uuid')
    const prevSelAcc = ConfigManager.getSelectedAccount()
    const targetAcc = ConfigManager.getAuthAccount(uuid)
    if(targetAcc.type === 'microsoft') {
        msAccDomElementCache = parent
        switchView(getCurrentView(), VIEWS.waiting, 500, 500, () => {
            ipcRenderer.send(MSFT_OPCODE.OPEN_LOGOUT, uuid, isLastAccount)
        })
    } else {
        AuthManager.removeMojangAccount(uuid).then(() => {
            if(!isLastAccount && uuid === prevSelAcc.uuid){
                const selAcc = ConfigManager.getSelectedAccount()
                refreshAuthAccountSelected(selAcc.uuid)
                updateSelectedAccount(selAcc)
                validateSelectedAccount()
            }
            if(isLastAccount) {
                loginOptionsCancelEnabled(false)
                loginOptionsViewOnLoginSuccess = VIEWS.settings
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                switchView(getCurrentView(), VIEWS.loginOptions)
            }
        })
        $(parent).fadeOut(250, () => { parent.remove() })
    }
}

ipcRenderer.on(MSFT_OPCODE.REPLY_LOGOUT, (_, ...arguments_) => {
    if (arguments_[0] === MSFT_REPLY_TYPE.ERROR) {
        switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
            if(arguments_.length > 1 && arguments_[1] === MSFT_ERROR.NOT_FINISHED) return
            setOverlayContent(
                Lang.queryJS('settings.msftLogout.errorTitle'),
                Lang.queryJS('settings.msftLogout.errorMessage'),
                Lang.queryJS('settings.msftLogout.okButton')
            )
            setOverlayHandler(() => { toggleOverlay(false) })
            toggleOverlay(true)
        })
    } else if(arguments_[0] === MSFT_REPLY_TYPE.SUCCESS) {
        const uuid = arguments_[1]
        const isLastAccount = arguments_[2]
        const prevSelAcc = ConfigManager.getSelectedAccount()
        AuthManager.removeMicrosoftAccount(uuid).then(() => {
            if(!isLastAccount && uuid === prevSelAcc.uuid){
                const selAcc = ConfigManager.getSelectedAccount()
                refreshAuthAccountSelected(selAcc.uuid)
                updateSelectedAccount(selAcc)
                validateSelectedAccount()
            }
            if(isLastAccount) {
                loginOptionsCancelEnabled(false)
                loginOptionsViewOnLoginSuccess = VIEWS.settings
                loginOptionsViewOnLoginCancel = VIEWS.loginOptions
                switchView(getCurrentView(), VIEWS.loginOptions)
            }
            if(msAccDomElementCache) {
                msAccDomElementCache.remove()
                msAccDomElementCache = null
            }
        }).finally(() => {
            if(!isLastAccount) {
                switchView(getCurrentView(), VIEWS.settings, 500, 500)
            }
        })
    }
})

function refreshAuthAccountSelected(uuid){
    Array.from(document.getElementsByClassName('settingsAuthAccount')).map((val) => {
        const selBtn = val.getElementsByClassName('settingsAuthAccountSelect')[0]
        if(uuid === val.getAttribute('uuid')){
            selBtn.setAttribute('selected', '')
            selBtn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectedButton')
        } else {
            selBtn.removeAttribute('selected')
            selBtn.innerHTML = Lang.queryJS('settings.authAccountSelect.selectButton')
        }
    })
}

const settingsCurrentMicrosoftAccounts = document.getElementById('settingsCurrentMicrosoftAccounts')
const settingsCurrentMojangAccounts = document.getElementById('settingsCurrentMojangAccounts')

function populateAuthAccounts(){
    const authAccounts = ConfigManager.getAuthAccounts()
    const authKeys = Object.keys(authAccounts)
    if(authKeys.length === 0) return
    const selectedUUID = ConfigManager.getSelectedAccount().uuid
    let microsoftAuthAccountStr = ''
    let mojangAuthAccountStr = ''

    authKeys.forEach((val) => {
        const acc = authAccounts[val]
        const accHtml = `<div class="settingsAuthAccount" uuid="${acc.uuid}">
            <div class="settingsAuthAccountLeft">
                <img class="settingsAuthAccountImage" alt="${acc.displayName}" src="https://mc-heads.net/body/${acc.uuid}/60">
            </div>
            <div class="settingsAuthAccountRight">
                <div class="settingsAuthAccountDetails">
                    <div class="settingsAuthAccountDetailPane">
                        <div class="settingsAuthAccountDetailTitle">${Lang.queryJS('settings.authAccountPopulate.username')}</div>
                        <div class="settingsAuthAccountDetailValue">${acc.displayName}</div>
                    </div>
                    <div class="settingsAuthAccountDetailPane">
                        <div class="settingsAuthAccountDetailTitle">${Lang.queryJS('settings.authAccountPopulate.uuid')}</div>
                        <div class="settingsAuthAccountDetailValue">${acc.uuid}</div>
                    </div>
                </div>
                <div class="settingsAuthAccountActions">
                    <button class="settingsAuthAccountSelect" ${selectedUUID === acc.uuid ? 'selected>' + Lang.queryJS('settings.authAccountPopulate.selectedAccount') : '>' + Lang.queryJS('settings.authAccountPopulate.selectAccount')}</button>
                    <div class="settingsAuthAccountWrapper">
                        <button class="settingsAuthAccountLogOut">${Lang.queryJS('settings.authAccountPopulate.logout')}</button>
                    </div>
                </div>
            </div>
        </div>`
        if(acc.type === 'microsoft') {
            microsoftAuthAccountStr += accHtml
        } else {
            mojangAuthAccountStr += accHtml
        }
    })
    settingsCurrentMicrosoftAccounts.innerHTML = microsoftAuthAccountStr
    settingsCurrentMojangAccounts.innerHTML = mojangAuthAccountStr
}

function prepareAccountsTab() {
    populateAuthAccounts()
    bindAuthAccountSelect()
    bindAuthAccountLogOut()
}

document.getElementById('settingsGameWidth').addEventListener('keydown', (e) => { if(/^[-.eE]$/.test(e.key)) e.preventDefault() })
document.getElementById('settingsGameHeight').addEventListener('keydown', (e) => { if(/^[-.eE]$/.test(e.key)) e.preventDefault() })

const settingsModsContainer = document.getElementById('settingsModsContainer')

// --- GESTION DES MODS (MISE À JOUR) ---

async function resolveModsForUI(){
    const serv = ConfigManager.getSelectedServer()
    const distro = await DistroAPI.getDistribution()
    const servConf = ConfigManager.getModConfiguration(serverId = serv)
    const modStr = parseModulesForUI(distro.getServerById(serv).modules, false, servConf.mods)
    
    // On injecte le HTML (Requis est vide ou caché, Optionnels est rempli)
    document.getElementById('settingsReqModsContent').innerHTML = modStr.reqMods
    document.getElementById('settingsOptModsContent').innerHTML = modStr.optMods

    // Ajout des événements de clic sur les nouveaux éléments optionnels
    const optModsElements = document.getElementsByClassName('settingsOptionalMod')
    for(let el of optModsElements) {
        el.onclick = () => toggleOptionalMod(el)
    }
}

function parseModulesForUI(mdls, submodules, servConf){
    let reqMods = ''
    let optMods = ''

    for(const mdl of mdls){
        if(mdl.rawModule.type === 'ForgeMod' || mdl.rawModule.type === 'LiteMod' || mdl.rawModule.type === 'LiteLoader' || mdl.rawModule.type === 'FabricMod'){
            
            const modId = mdl.getVersionlessMavenIdentifier()
            
            if(mdl.getRequired().value){
                // REQUIS (Généré mais caché par CSS)
                // ... code requis standard si besoin ...
            } else {
                // OPTIONNEL (Génération avec Switch)
                let isEnabled = servConf && servConf[modId] != null ? servConf[modId] : mdl.getRequired().def
                if(typeof isEnabled === 'object') isEnabled = isEnabled.value

                optMods += `<div class="settingsOptionalMod" id="${modId}" ${isEnabled ? 'enabled' : ''}>
                    <div class="optModInfo">
                        <span class="optModName">${mdl.rawModule.name}</span>
                        <span class="optModDesc">${mdl.rawModule.description || 'Module Optionnel'}</span>
                    </div>
                    <div class="optModSwitch">
                        <div class="toggleSwitch">
                            <div class="toggleSwitchSlider" style="${isEnabled ? 'background-color: var(--set-accent); border-color: var(--set-accent);' : ''}"></div>
                            <style>
                                /* Petit hack inline pour simuler l'état checked du slider CSS sans input réel complexe */
                                #${modId}[enabled] .toggleSwitchSlider::before { transform: translateX(22px); background-color: white; }
                            </style>
                        </div>
                    </div>
                </div>`
            }
        }
    }
    return { reqMods, optMods }
}

// Fonction pour activer/désactiver un mod optionnel au clic
function toggleOptionalMod(element) {
    const isEnabled = element.hasAttribute('enabled')
    const slider = element.querySelector('.toggleSwitchSlider')
    
    if(isEnabled) {
        element.removeAttribute('enabled')
        // Mise à jour visuelle manuelle du switch (ou laisser le CSS le faire si refait proprement)
        slider.style.backgroundColor = ''
        slider.style.borderColor = ''
    } else {
        element.setAttribute('enabled', '')
        slider.style.backgroundColor = 'var(--set-accent)'
        slider.style.borderColor = 'var(--set-accent)'
    }
    saveModConfiguration()
}

function saveModConfiguration(){
    const serv = ConfigManager.getSelectedServer()
    const modConf = ConfigManager.getModConfiguration(serv) || { mods: {} }
    if(!modConf.mods) modConf.mods = {}

    const optMods = document.getElementsByClassName('settingsOptionalMod')
    for(let mod of optMods) {
        modConf.mods[mod.id] = mod.hasAttribute('enabled')
    }

    ConfigManager.setModConfiguration(serv, modConf)
}
// Pas de toggle switch pour l'instant car mods optionnels cachés
function bindModsToggleSwitch(){ }
function saveModConfiguration(){
    const serv = ConfigManager.getSelectedServer()
    const modConf = ConfigManager.getModConfiguration(serv)
    ConfigManager.setModConfiguration(serv, modConf)
}

async function resolveDropinModsForUI(){ }

// --- GESTION DES SHADERS (DROPDOWN CYBER) ---

let CACHE_SETTINGS_INSTANCE_DIR
let CACHE_SHADERPACKS
let CACHE_SELECTED_SHADERPACK

async function resolveShaderpacksForUI(){
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    CACHE_SETTINGS_INSTANCE_DIR = path.join(ConfigManager.getInstanceDirectory(), serv.rawServer.id)
    CACHE_SHADERPACKS = DropinModUtil.scanForShaderpacks(CACHE_SETTINGS_INSTANCE_DIR)
    CACHE_SELECTED_SHADERPACK = DropinModUtil.getEnabledShaderpack(CACHE_SETTINGS_INSTANCE_DIR)
    
    setShadersOptions(CACHE_SHADERPACKS, CACHE_SELECTED_SHADERPACK)
}

// Génère la liste
function setShadersOptions(arr, selected){
    const listContainer = document.getElementById('shaderOptionsList')
    const selectedLabel = document.getElementById('shaderSelectedName')
    
    listContainer.innerHTML = ''

    // Fonction pour créer une option HTML
    const createOption = (name, value) => {
        const div = document.createElement('div')
        div.className = 'cyber-option'
        div.setAttribute('data-value', value)
        div.innerText = name
        
        if(value === selected) {
            div.classList.add('selected')
            selectedLabel.innerText = name // Met à jour le titre
        }

        div.onclick = () => {
            // Mise à jour visuelle
            selectedLabel.innerText = name
            document.querySelectorAll('.cyber-option').forEach(el => el.classList.remove('selected'))
            div.classList.add('selected')
            
            // Fermer le menu et sauvegarder
            toggleShaderDropdown()
            saveShaderpackSettings()
        }
        return div
    }

    // 1. Ajouter OFF
    listContainer.appendChild(createOption('DÉSACTIVÉ (OFF)', 'OFF'))

    // 2. Ajouter les packs
    arr.forEach(pack => {
        listContainer.appendChild(createOption(pack.name, pack.fullName))
    })
    
    // Si rien n'est sélectionné (cas rare), mettre OFF par défaut
    if(!selected || selected === 'OFF'){
        selectedLabel.innerText = 'DÉSACTIVÉ (OFF)'
    }
}

// Ouvre/Ferme le menu (appelé par le onclick dans le HTML)
function toggleShaderDropdown() {
    const dropdown = document.getElementById('shaderSelector')
    dropdown.classList.toggle('active')
}

// Fermer le menu si on clique ailleurs
document.addEventListener('click', function(e) {
    const dropdown = document.getElementById('shaderSelector')
    if (dropdown && !dropdown.contains(e.target)) {
        dropdown.classList.remove('active')
    }
})

// Sauvegarde
function saveShaderpackSettings(){
    const selectedOption = document.querySelector('.cyber-option.selected')
    let sel = 'OFF'
    if(selectedOption){
        sel = selectedOption.getAttribute('data-value')
    }
    DropinModUtil.setEnabledShaderpack(CACHE_SETTINGS_INSTANCE_DIR, sel)
}

// Fonction vide pour compatibilité
function bindShaderpackButton() {}

async function loadSelectedServerOnModsTab(){
    const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    const selServContent = document.getElementsByClassName('settingsSelServContent')[0]
    selServContent.innerHTML = serv.rawServer.name
}

Array.from(document.getElementsByClassName('settingsSwitchServerButton')).forEach(el => {
    el.addEventListener('click', async e => {
        e.target.blur()
        await toggleServerSelection(true)
    })
})

function saveAllModConfigurations(){
    saveModConfiguration()
    ConfigManager.save()
    saveShaderpackSettings()
}

function animateSettingsTabRefresh(){
    $(`#${selectedSettingsTab}`).fadeOut(500, async () => {
        await prepareSettings()
        $(`#${selectedSettingsTab}`).fadeIn(500)
    })
}

async function prepareModsTab(first){
    await resolveModsForUI()
    await resolveShaderpacksForUI()
    await loadSelectedServerOnModsTab()
}

/* Java Tab */
const settingsMaxRAMRange = document.getElementById('settingsMaxRAMRange')
const settingsMinRAMRange = document.getElementById('settingsMinRAMRange')
const settingsMaxRAMLabel = document.getElementById('settingsMaxRAMLabel')
const settingsMinRAMLabel = document.getElementById('settingsMinRAMLabel')
const settingsMemoryTotal = document.getElementById('settingsMemoryTotal')
const settingsMemoryAvail = document.getElementById('settingsMemoryAvail')
const settingsJavaExecDetails = document.getElementById('settingsJavaExecDetails')
const settingsJavaReqDesc = document.getElementById('settingsJavaReqDesc')
const settingsJvmOptsLink = document.getElementById('settingsJvmOptsLink')

settingsMinRAMRange.onchange = (e) => {
    const sMaxV = Number(settingsMaxRAMRange.getAttribute('value'))
    const sMinV = Number(settingsMinRAMRange.getAttribute('value'))
    const bar = e.target.getElementsByClassName('rangeSliderBar')[0]
    const max = os.totalmem()/1073741824
    if(sMinV >= max/2){
        bar.style.background = '#e86060'
    } else if(sMinV >= max/4) {
        bar.style.background = '#e8e18b'
    } else {
        bar.style.background = null
    }
    if(sMaxV < sMinV){
        const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange)
        updateRangedSlider(settingsMaxRAMRange, sMinV, ((sMinV-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)
        settingsMaxRAMLabel.innerHTML = sMinV.toFixed(1) + 'G'
    }
    settingsMinRAMLabel.innerHTML = sMinV.toFixed(1) + 'G'
}

settingsMaxRAMRange.onchange = (e) => {
    const sMaxV = Number(settingsMaxRAMRange.getAttribute('value'))
    const sMinV = Number(settingsMinRAMRange.getAttribute('value'))
    const bar = e.target.getElementsByClassName('rangeSliderBar')[0]
    const max = os.totalmem()/1073741824
    if(sMaxV >= max/2){
        bar.style.background = '#e86060'
    } else if(sMaxV >= max/4) {
        bar.style.background = '#e8e18b'
    } else {
        bar.style.background = null
    }
    if(sMaxV < sMinV){
        const sliderMeta = calculateRangeSliderMeta(settingsMaxRAMRange)
        updateRangedSlider(settingsMinRAMRange, sMaxV, ((sMaxV-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)
        settingsMinRAMLabel.innerHTML = sMaxV.toFixed(1) + 'G'
    }
    settingsMaxRAMLabel.innerHTML = sMaxV.toFixed(1) + 'G'
}

function calculateRangeSliderMeta(v){
    const val = {
        max: Number(v.getAttribute('max')),
        min: Number(v.getAttribute('min')),
        step: Number(v.getAttribute('step')),
    }
    val.ticks = (val.max-val.min)/val.step
    val.inc = 100/val.ticks
    return val
}

function bindRangeSlider(){
    Array.from(document.getElementsByClassName('rangeSlider')).map((v) => {
        const track = v.getElementsByClassName('rangeSliderTrack')[0]
        const value = v.getAttribute('value')
        const sliderMeta = calculateRangeSliderMeta(v)
        updateRangedSlider(v, value, ((value-sliderMeta.min)/sliderMeta.step)*sliderMeta.inc)
        track.onmousedown = (e) => {
            document.onmouseup = (e) => {
                document.onmousemove = null
                document.onmouseup = null
            }
            document.onmousemove = (e) => {
                const diff = e.pageX - v.offsetLeft - track.offsetWidth/2
                if(diff >= 0 && diff <= v.offsetWidth-track.offsetWidth/2){
                    const perc = (diff/v.offsetWidth)*100
                    const notch = Number(perc/sliderMeta.inc).toFixed(0)*sliderMeta.inc
                    if(Math.abs(perc-notch) < sliderMeta.inc/2){
                        updateRangedSlider(v, sliderMeta.min+(sliderMeta.step*(notch/sliderMeta.inc)), notch)
                    }
                }
            }
        }
    }) 
}

function updateRangedSlider(element, value, notch){
    const oldVal = element.getAttribute('value')
    const bar = element.getElementsByClassName('rangeSliderBar')[0]
    const track = element.getElementsByClassName('rangeSliderTrack')[0]
    element.setAttribute('value', value)
    if(notch < 0) notch = 0
    else if(notch > 100) notch = 100
    const event = new MouseEvent('change', { target: element, type: 'change', bubbles: false, cancelable: true })
    let cancelled = !element.dispatchEvent(event)
    if(!cancelled){
        track.style.left = notch + '%'
        bar.style.width = notch + '%'
    } else {
        element.setAttribute('value', oldVal)
    }
}

function populateMemoryStatus(){
    settingsMemoryTotal.innerHTML = Number((os.totalmem()-1073741824)/1073741824).toFixed(1) + 'G'
    settingsMemoryAvail.innerHTML = Number(os.freemem()/1073741824).toFixed(1) + 'G'
}

async function populateJavaExecDetails(execPath){
    const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    const details = await validateSelectedJvm(ensureJavaDirIsRoot(execPath), server.effectiveJavaOptions.supported)
    if(details != null) {
        settingsJavaExecDetails.innerHTML = Lang.queryJS('settings.java.selectedJava', { version: details.semverStr, vendor: details.vendor })
    } else {
        settingsJavaExecDetails.innerHTML = Lang.queryJS('settings.java.invalidSelection')
    }
}

function populateJavaReqDesc(server) {
    settingsJavaReqDesc.innerHTML = Lang.queryJS('settings.java.requiresJava', { major: server.effectiveJavaOptions.suggestedMajor })
}

function populateJvmOptsLink(server) {
    // Links are static or managed elsewhere, function kept for compatibility
}

function bindMinMaxRam(server) {
    const SETTINGS_MAX_MEMORY = ConfigManager.getAbsoluteMaxRAM(server.rawServer.javaOptions?.ram)
    const SETTINGS_MIN_MEMORY = ConfigManager.getAbsoluteMinRAM(server.rawServer.javaOptions?.ram)
    settingsMaxRAMRange.setAttribute('max', SETTINGS_MAX_MEMORY)
    settingsMaxRAMRange.setAttribute('min', SETTINGS_MIN_MEMORY)
    settingsMinRAMRange.setAttribute('max', SETTINGS_MAX_MEMORY)
    settingsMinRAMRange.setAttribute('min', SETTINGS_MIN_MEMORY)
}

async function prepareJavaTab(){
    const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
    bindMinMaxRam(server)
    bindRangeSlider(server)
    populateMemoryStatus()
    populateJavaReqDesc(server)
    populateJvmOptsLink(server)
}

/* About Tab */
const settingsTabAbout = document.getElementById('settingsTabAbout')
const settingsAboutChangelogTitle = settingsTabAbout.getElementsByClassName('settingsChangelogTitle')[0]
const settingsAboutChangelogText = settingsTabAbout.getElementsByClassName('settingsChangelogText')[0]
const settingsAboutChangelogButton = settingsTabAbout.getElementsByClassName('settingsChangelogButton')[0]

document.getElementById('settingsAboutDevToolsButton').onclick = (e) => {
    let window = remote.getCurrentWindow()
    window.toggleDevTools()
}

function isPrerelease(version){
    const preRelComp = semver.prerelease(version)
    return preRelComp != null && preRelComp.length > 0
}

function populateVersionInformation(version, valueElement, titleElement, checkElement){
    valueElement.innerHTML = version
    if(isPrerelease(version)){
        titleElement.innerHTML = Lang.queryJS('settings.about.preReleaseTitle')
        titleElement.style.color = '#ff886d'
        checkElement.style.background = '#ff886d'
    } else {
        titleElement.innerHTML = Lang.queryJS('settings.about.stableReleaseTitle')
        titleElement.style.color = null
        checkElement.style.background = null
    }
}

function populateAboutVersionInformation(){
    populateVersionInformation(remote.app.getVersion(), document.getElementById('settingsAboutCurrentVersionValue'), document.getElementById('settingsAboutCurrentVersionTitle'), document.getElementById('settingsAboutCurrentVersionCheck'))
}

function populateReleaseNotes(){
    $.ajax({
        url: 'https://github.com/dscalzi/HeliosLauncher/releases.atom',
        success: (data) => {
            const version = 'v' + remote.app.getVersion()
            const entries = $(data).find('entry')
            for(let i=0; i<entries.length; i++){
                const entry = $(entries[i])
                let id = entry.find('id').text()
                id = id.substring(id.lastIndexOf('/')+1)
                if(id === version){
                    settingsAboutChangelogTitle.innerHTML = entry.find('title').text()
                    settingsAboutChangelogText.innerHTML = entry.find('content').text()
                    settingsAboutChangelogButton.href = entry.find('link').attr('href')
                }
            }
        },
        timeout: 2500
    }).catch(err => {
        settingsAboutChangelogText.innerHTML = Lang.queryJS('settings.about.releaseNotesFailed')
    })
}

function prepareAboutTab(){
    populateAboutVersionInformation()
    populateReleaseNotes()
}

/* Update Tab */
const settingsTabUpdate = document.getElementById('settingsTabUpdate')
const settingsUpdateTitle = document.getElementById('settingsUpdateTitle')
const settingsUpdateVersionCheck = document.getElementById('settingsUpdateVersionCheck')
const settingsUpdateVersionTitle = document.getElementById('settingsUpdateVersionTitle')
const settingsUpdateVersionValue = document.getElementById('settingsUpdateVersionValue')
const settingsUpdateChangelogTitle = settingsTabUpdate.getElementsByClassName('settingsChangelogTitle')[0]
const settingsUpdateChangelogText = settingsTabUpdate.getElementsByClassName('settingsChangelogText')[0]
const settingsUpdateChangelogCont = settingsTabUpdate.getElementsByClassName('settingsChangelogContainer')[0]
const settingsUpdateActionButton = document.getElementById('settingsUpdateActionButton')

function settingsUpdateButtonStatus(text, disabled = false, handler = null){
    settingsUpdateActionButton.innerHTML = text
    settingsUpdateActionButton.disabled = disabled
    if(handler != null){
        settingsUpdateActionButton.onclick = handler
    }
}

function populateSettingsUpdateInformation(data){
    if(data != null){
        settingsUpdateTitle.innerHTML = isPrerelease(data.version) ? Lang.queryJS('settings.updates.newPreReleaseTitle') : Lang.queryJS('settings.updates.newReleaseTitle')
        settingsUpdateChangelogCont.style.display = null
        settingsUpdateChangelogTitle.innerHTML = data.releaseName
        settingsUpdateChangelogText.innerHTML = data.releaseNotes
        populateVersionInformation(data.version, settingsUpdateVersionValue, settingsUpdateVersionTitle, settingsUpdateVersionCheck)
        
        if(process.platform === 'darwin'){
            settingsUpdateButtonStatus(Lang.queryJS('settings.updates.downloadButton'), false, () => {
                shell.openExternal(data.darwindownload)
            })
        } else {
            settingsUpdateButtonStatus(Lang.queryJS('settings.updates.downloadingButton'), true)
        }
    } else {
        settingsUpdateTitle.innerHTML = Lang.queryJS('settings.updates.latestVersionTitle')
        settingsUpdateChangelogCont.style.display = 'none'
        populateVersionInformation(remote.app.getVersion(), settingsUpdateVersionValue, settingsUpdateVersionTitle, settingsUpdateVersionCheck)
        settingsUpdateButtonStatus(Lang.queryJS('settings.updates.checkForUpdatesButton'), false, () => {
            if(!isDev){
                ipcRenderer.send('autoUpdateAction', 'checkForUpdate')
                settingsUpdateButtonStatus(Lang.queryJS('settings.updates.checkingForUpdatesButton'), true)
            }
        })
    }
}

function prepareUpdateTab(data = null){
    populateSettingsUpdateInformation(data)
}

async function prepareSettings(first = false) {
    if(first){
        setupSettingsTabs()
        initSettingsValidators()
        prepareUpdateTab()
    } else {
        await prepareModsTab()
    }
    await initSettingsValues()
    prepareAccountsTab()
    await prepareJavaTab()
    prepareAboutTab()
}