# Distribution Index

You can use [Nebula](https://github.com/dscalzi/Nebula) to automate the generation of a distribution index.

The distribution index is written in JSON. The general format of the index is as posted below.

\`\`\`json
{
    "version": "1.0.0",
    "discord": {
        "clientId": "TON_CLIENT_ID",
        "smallImageText": "Invergence RP",
        "smallImageKey": "seal-circle"
    },
    "rss": "https://invergencenetwork.eu/articles/index.rss",
    "servers": [
        {
            "id": "Invergence_Server",
            "name": "Invergence RP Client",
            "description": "Serveur officiel Invergence RP.",
            "icon": "https://invergencenetwork.eu/files/icon.png",
            "version": "1.0.0",
            "address": "play.invergencenetwork.eu",
            "minecraftVersion": "1.20.1",
            "discord": {
                "shortId": "Invergence",
                "largeImageText": "Invergence RP Server",
                "largeImageKey": "server-example"
            },
            "mainServer": true,
            "autoconnect": true,
            "modules": [
                "Module Objects Here"
            ]
        }
    ]
}
\`\`\`