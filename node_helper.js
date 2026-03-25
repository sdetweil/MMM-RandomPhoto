require("url"); // for nextcloud
const https = require("node:https"); // for nextcloud
const fs = require("fs"); // for localdirectory
const Log = require("logger");

const NodeHelper = require("node_helper");

module.exports = NodeHelper.create({
    config: {},
    imageList: {},
    start: function() {
        var self = this;

        this.nextcloud = false;
        this.localdirectory = false;

        this.expressApp.get("/" + this.name + "/images/:id/:randomImageName", async function(request, response) {
            var imageBase64Encoded = await self.fetchEncodedImage(decodeURIComponent(request.params.randomImageName, request.params.id));
            response.send(imageBase64Encoded);
        });
    },


    socketNotificationReceived: function(notification, payload) {
        //console.log("["+ this.name + "] received a '" + notification + "' with payload: " + payload);
        if (notification === "SET_CONFIG") {
            this.imageList[payload.id]=[]
            this.config[payload.id] = payload;
            if (this.config[payload.id].imageRepository === "nextcloud") {

                this.nextcloud = true;
            } else if (this.config[payload.id].imageRepository === "localdirectory") {
                this.localdirectory = true;
            }
        }
        if (notification === "FETCH_IMAGE_LIST") {
            if (this.imageList[payload.id] === undefined)
                this.imageList[payload.id]
            if (this.config[payload.id].imageRepository === "nextcloud") {
                this.fetchNextcloudImageList(this.config[payload.id]);
            }
            if (this.config[payload.id].imageRepository === "localdirectory") {
                this.fetchLocalImageList(this.config[payload.id]);
            }
        }
    },

    fetchLocalImageDirectory: function(path,config) {
        var self = this;

        // Validate path
        if (!fs.existsSync(path)) {
            console.log("["+ self.name + "] ERROR - specified path does not exist: " + path);
            return false;
        }

	    const excludePattern = config.repositoryConfig.exclude?.map(pattern => new RegExp(pattern));

        var fileList = fs.readdirSync(path, { withFileTypes: true });
        if (fileList.length > 0) {
            for (var f = 0; f < fileList.length; f++) {
		if (excludePattern?.some(regex => regex.test(fileList[f].name))) continue;

                if (fileList[f].isFile()) {
                    //TODO: add mime type check here
                    self.imageList[config.id].push(encodeURIComponent(path + "/" + fileList[f].name));
                }
                if ((config.repositoryConfig.recursive === true) && fileList[f].isDirectory()) {
                    self.fetchLocalImageDirectory(path + "/" + fileList[f].name,config);
                }
            }
            return;
        }
    },

    fetchLocalImageList: function(config) {
        var self = this;
        var path = config.repositoryConfig.path;

        self.imageList[config.id] = [];
    	self.fetchLocalImageDirectory(path,config);

        self.sendSocketNotification("IMAGE_LIST", { data: self.imageList[config.id], id: config.id });
        return false;
    },


    fetchNextcloudImageList: function(config) {
        var self = this;
        var imageList = [];
        var path = config.repositoryConfig.path;

        const urlParts = new URL(path);
        const requestOptions = {
            method: "PROPFIND",
            headers: {
                "Authorization": "Basic " + new Buffer.from(config.repositoryConfig.username + ":" + config.repositoryConfig.password).toString("base64")
            }
        };
        https.get(path, requestOptions, function(response) {
            var body = "";
            response.on("data", function(data) {
                body += data;
            });
            response.on("end", function() {
                imageList = body.match(/href>\/[^<]+/g);
                imageList.shift(); // delete first array entry, because it contains the link to the current folder
                if (imageList && imageList.length > 0) {
                    imageList.forEach(function(item, index) {
                        // remove clutter and the pathing from the entry -> only save file name
                        imageList[index] = encodeURIComponent(item.replace("href>" + urlParts.pathname, ""));
                        //console.log("[" + self.name + "] Found entry: " + imageList[index]);
                    });
                    self.sendSocketNotification("IMAGE_LIST", { data: imageList, id: config.id });
                    return;
                } else {
                    console.log("[" + this.name + "] WARNING: did not get any images from nextcloud url");
                    return false;
                }
            });
        })
        .on("error", function(err) {
            console.log("[" + this.name + "] ERROR: " + err);
            return false;
        });
    },


    fetchEncodedImage: async function(passedImageName,id) {
        var self = this;
        config=this.config[id]
        return new Promise(function(resolve, reject) {
            var fullImagePath = passedImageName;

            // Local files
            if (self.localdirectory) {
                var fileEncoded = "data:image/jpeg;base64," + fs.readFileSync(fullImagePath, { encoding: 'base64' });
                resolve(fileEncoded);
            }

            // Nextcloud
            else if (self.nextcloud) {
                const requestOptions = {
                    method: "GET",
                    headers: {
                        "Authorization": "Basic " + new Buffer.from(self.config.repositoryConfig.username + ":" + config.repositoryConfig.password).toString("base64")
                    }
                };
                https.get(config.repositoryConfig.path + fullImagePath, requestOptions, (response) => {
                    response.setEncoding('base64');
                    var fileEncoded = "data:" + response.headers["content-type"] + ";base64,";
                    response.on("data", (data) => { fileEncoded += data; });
                    response.on("end", () => {
                        resolve(fileEncoded);
                    });
                })
                .on("error", function(err) {
                    console.log("[" + this.name + "] ERROR: " + err);
                    return false;
                });
            }
        })


        /**
        var getMimeObject = spawn("file", ["-b", "--mime-type", "-0", "-0", file]);
        getMimeObject.stdout.on('data', (data) => {
            var mimeType = data.toString().replace("\0", "");
            //console.log("mime type is: '" + mimeType + "'");
            var fileEncoded = "data:" + mimeType + ";base64,";
            fileEncoded += fs.readFileSync(file, { encoding: 'base64' });
            //console.log("base64:");
            console.log("<img src='" + fileEncoded + "' />");
            //return fileEncoded;
        });
        **/
    },


});
