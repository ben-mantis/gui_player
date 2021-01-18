/* Copyright (C) Omnivor, Inc - All Rights Reserved
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * 
 * BY USING OR ACCESSING THIS SOFTWARE YOU AGREE AS FOLLOWS: 
 * 
 * THIS SOFTWARE IS PROVIDED BY OMNIVOR, INC. (“OMNIVOR”) ”AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL OMNIVOR BE LIABLE FOR ANY DIRECT, INDIRECT INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION: HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 * 
 * YOU MAY NOT COPY THIS FILE OR THE CONTENTS THEREOF, EXCEPT AS REASONABLY NECESSARY TO VIEW CONTENT PRESENTED TO YOU BY AN AUTHORIZED LICENSEE OF OMNIVOR FOR YOUR OWN PERSONAL AND NON-COMMERCIAL USE.
 * 
 * THIS SOFTWARE INCLUDES PROPRIETARY, TRADE SECRET-INFORMATION OF OMNIVOR. YOU AGREE NOT TO USE THIS SOFTWARE FOR THE PURPOSE OF DEVELOPING ANY PRODUCT OR SERVICE THAT COMPETES WITH THE SOFTWARE OR OMNIVOR PRODUCTS OR TECHNOLOGY.
 * 
 * 
 * run server
 npx http-server -p 8090
 * run with file (mp4/byte)
 http://localhost:8090/index.html?videoUrl=demoPitch_52.35-FM_az_MPH_A7_singleHeader_ak.mp4&bytesUrl=demoPitch_52.35-FM_az_MPH_A7_singleHeader_ak.bytes
 http://localhost:8090/index.html?videoUrl=demoPitch_52.35-FM_az_MPH_A7_singleHeader_ak_5Mb.mp4&bytesUrl=demoPitch_52.35-FM_az_MPH_A7_singleHeader_ak.bytes
 * convert h264 to mp4 (with audio)
input="demoPitch_52.35-FM_az_MPH_A7_singleHeader_ak"
* 20Mb
ffmpeg -r 15 -i $input.h264 -i $input.wav -vsync 0 -c:v libx264 -c:a aac -b:v 20M $input.mp4
* 5Mb
ffmpeg -r 15 -i $input.h264 -i $input.wav -vsync 0 -tune zerolatency  -preset ultrafast -c:v libx264 -c:a aac -b:v 5M input_5Mb.mp4
 */
class Application {
    constructor(
        canvasId,
        playButtonId,
        playButtonIconId,
        volumeButtonId,
        volumeButtonIconId,
        volumeSliderId,
        gestureLogoId,
        spinnerId,
        invalidClipId,
        browserSupportId,
        brandLogoId,
        bgColor,
        autoplay,
        clipId,
        videoUrl,
        bytesUrl,
        metadataUrl) {
        const self = this;

        self.clearColor_ = bgColor;
        self.canvas_ = document.getElementById(canvasId);

        // Get an OpenGL context and verify we have the proper GL function support.
        self.gl_ = twgl.getContext(self.canvas_);
        twgl.addExtensionsToContext(self.gl_);
        self.log_("using:" + self.gl_.getParameter(self.gl_.VERSION));

        self.clearCanvas_();

        // Setup the spinner and gesture logo so they can be turned off when the video loads.
        self.spinner_ = null;
        if (spinnerId != null) {
            self.spinner_ = document.getElementById(spinnerId);
        }

        self.gestureLogo_ = null;
        if (gestureLogoId != null) {
            self.gestureLogo_ = document.getElementById(gestureLogoId);
        }

        // Initialize the volume slider early so it can be set properly for
        // the platform even if we bail out early due to unsupported browser
        // or invalid clip.
        self.volumeSlider_ = null;
        if (volumeSliderId != null) {
            self.volumeSlider_ = document.getElementById(volumeSliderId);
        }

        // If the current browser is not supported, display a message, hide
        // the loading spinner, and bail out early.
        const supportedBrowser = OmniUtils.checkBrowserSupport();
        if (!supportedBrowser) {
            const browserSupport = document.getElementById(browserSupportId);
            if (browserSupport != null) {
                browserSupport.style.display = "block";
            }

            self.setSpinnerVisible_(false);
            self.setGestureLogoVisible_(false);
            return;
        }

        // Make sure the spinner is visible until the video loads.
        self.setSpinnerVisible_(true);

        const clipFunc = async () => {
            // If a clip ID is provided, use that. Otherwise check for video & bytes URLs.
            if (clipId) {
                return OmniNetwork.requestClipById(clipId);
            } else if (videoUrl && bytesUrl) {
                return OmniNetwork.requestVideoClipByUrl(videoUrl, bytesUrl, metadataUrl);
            } else {
                throw Error("Must provide a Clip ID or a Video and Bytes URL");
            }
        }

        // Asynchronously request and load the clip info. If no clip is
        // retrieved or there is an error in the request, it is handled in
        // the 'catch' block below.
        clipFunc().then((clipInfo) => {
            if (!("videoUrl" in clipInfo)) {
                throw Error("videoUrl not specified.");
            }

            self.autoplay_ = autoplay;

            // Set the play button's icon id so it can later be toggled
            // between Play and Pause.
            self.playButtonIconId_ = playButtonIconId;

            // Set the volume control id so it can be used
            // to adjust the volume of the video.
            self.volumeButtonIconId_ = volumeButtonIconId;
            self.initialVolume_ = 100;
            self.hasInteractedWithMedia_ = false;

            self.initializeUI_(playButtonId, volumeButtonId, brandLogoId);

            const metadata = clipInfo["metadata"];
            self.tileRenderer_ = new OmniRenderer(self.gl_, metadata);
            self.tileRenderer_.setVideoUrl(clipInfo["videoUrl"], clipInfo["bytesUrl"]);
            self.tileRenderer_.setContentLoadedCallback(() => {
                self.onContentLoaded_();
            });
            self.tileRenderer_.setVideoPlayCallback(() => {
                self.onVideoPlaying_();
            });
            self.tileRenderer_.setVideoPauseCallback(() => {
                self.onVideoPaused_();
            });
            self.tileRenderer_.setVideoEndedCallback(() => {
                self.onVideoEnded_();
            });

            self.tileRenderer_.setModelTransformParams(1.0, metadata['rotation'], { 'x': 0.0, 'y': 0.0, 'z': 0.0 });

            self.tileRenderer_.prepare();

            self.updatePlayerUI_();
            self.updateVolume_();

            // Allow zoom/pan using touch.  This value persists during the
            // touch motion events and allows us to determine whether to zoom
            // or to pan based on previous self.wheelSpan_ compared to the
            // currently calculated value.
            self.wheelSpan_ = 0.0;

            // Create a virtual track cylinder for rotating the scene.
            self.cameraControl_ = new OmniCamera(
                self.canvas_.offsetWidth,
                self.canvas_.offsetHeight,
                metadata,
                true);

            // Start render loop.
            self.initializeRenderer_();
        }).catch((error) => {
            self.log_(error);

            // The clip ID is not valid. Display a message and hide the loading spinner.
            if (invalidClipId != null) {
                const invalidClip = document.getElementById(invalidClipId);
                if (invalidClip != null) {
                    invalidClip.style.display = "block";
                }
            }

            self.setSpinnerVisible_(false);
            self.setGestureLogoVisible_(false);
        });
    }

    initializeUI_(playButtonId, volumeButtonId, brandLogoId) {
        const self = this;
        self.canvas_.addEventListener("wheel", (event) => {
            self.onWheelCanvas_(event);
        });
        self.canvas_.addEventListener("mousedown", (event) => {
            self.onMouseDownCanvas_(event);
        });
        self.canvas_.addEventListener("mouseup", (event) => {
            self.onMouseUpCanvas_(event);
        });
        self.canvas_.addEventListener("mousemove", (event) => {
            self.onMouseMoveCanvas_(event);
        });
        self.canvas_.addEventListener("mouseleave", (event) => {
            self.onMouseLeaveCanvas_(event);
        });
        self.canvas_.addEventListener("touchstart", (event) => {
            self.onTouchStartCanvas_(event);
        });
        self.canvas_.addEventListener("touchend", (event) => {
            self.onTouchEndCanvas_(event);
        });
        self.canvas_.addEventListener("touchmove", (event) => {
            self.onTouchMoveCanvas_(event);
        });
        self.canvas_.addEventListener("touchcancel", (event) => {
            self.onTouchCancelCanvas_(event);
        });

        const playButton = document.getElementById(playButtonId);
        playButton.addEventListener("click", () => {
            self.onClickPlayButton_();
        });

        if (self.volumeSlider_ != null) {
            self.volumeSlider_.addEventListener("mousedown", () => {
                self.volumeHack_();
            });
            self.volumeSlider_.addEventListener("touchstart", () => {
                self.volumeHack_();
            });
            self.volumeSlider_.addEventListener("input", () => {
                self.updateVolume_();
            });
        }

        if (volumeButtonId != null) {
            const volumeButton = document.getElementById(volumeButtonId);
            volumeButton.addEventListener("click", () => {
                self.onVolumeButtonClicked_();
            });
        }

        // Show or hide the play button and volume controls.
        const displayMode = "inline";
        if (self.playButtonIconId_ != null) {
            const playbutton = document.getElementById(self.playButtonIconId_);
            playbutton.style.display = displayMode;
        }
        if (self.volumeButtonIconId_ != null) {
            const volumeButtonIcon =
                document.getElementById(self.volumeButtonIconId_);
            volumeButtonIcon.style.display = displayMode;
        }

        // Check for mobile device (iOS or Android). Volume can only be
        // controlled by the physical device on iOS, so hide volume slider.
        // The mute/unmute button may still be visible.
        if (self.volumeSlider_ != null) {
            self.volumeSlider_.style.display = OmniUtils.isMobileBrowser() ? "none" : displayMode;
        }

        if (brandLogoId != null) {
            const brandLogo = document.getElementById(brandLogoId);
            brandLogo.style.display = "block";
        }

        const height_var = "--playbar-height-shown";
        const root = document.documentElement;
        const playbar_height = getComputedStyle(root).getPropertyValue(height_var);
        root.style.setProperty("--playbar-height", playbar_height);
    }

    clearCanvas_() {
        const self = this;
        twgl.resizeCanvasToDisplaySize(self.canvas_, window.devicePixelRatio);
        self.gl_.viewport(0, 0, self.canvas_.width, self.canvas_.height);
        self.gl_.clearColor(
            self.clearColor_[0], self.clearColor_[1], self.clearColor_[2],
            self.clearColor_[3]);
        self.gl_.clear(self.gl_.COLOR_BUFFER_BIT | self.gl_.DEPTH_BUFFER_BIT);
    }

    initializeRenderer_() {
        const self = this;

        const render = (time) => {
            self.clearCanvas_();

            // Get camera transforms.
            const cameraInfo = self.cameraControl_.getProjection(self.canvas_.clientWidth, self.canvas_.clientHeight);
            self.tileRenderer_.setProjection(cameraInfo["viewProjection"]);

            self.gl_.enable(self.gl_.DEPTH_TEST);
            self.tileRenderer_.render();
            self.gl_.disable(self.gl_.DEPTH_TEST);

            requestAnimationFrame(render);
        };

        requestAnimationFrame(render);
    }

    onClickPlayButton_() {
        const self = this;
        self.togglePlay_();
    }

    onContentLoaded_() {
        const self = this;

        if (self.autoplay_) {
            self.onClickPlayButton_();
        }

        // Once the video loads, hide the loading spinner (if there is one)
        // and show the gesture logo to indicate that the player is interactive.
        self.setSpinnerVisible_(false);
        self.setGestureLogoVisible_(true);

        self.cameraControl_.setEnabled(true);
    }

    onVideoPlaying_() {
        const self = this;
        self.log_("Video playing");
        self.updatePlayerUI_();
    }

    onVideoPaused_() {
        const self = this;
        self.log_("Video paused");
        self.updatePlayerUI_();
    }

    onVideoEnded_() {
        const self = this;
        self.log_("Video ended");
        self.updatePlayerUI_();
    }

    setSpinnerVisible_(visible) {
        const self = this;
        if (self.spinner_ != null) {
            self.spinner_.style.display = visible ? "block" : "none";
        }
    }

    setGestureLogoVisible_(visible) {
        const self = this;
        if (self.gestureLogo_ != null) {
            self.gestureLogo_.style.display = visible ? "block" : "none";
        }
    }

    updatePlayerUI_() {
        const self = this;

        const icon = document.getElementById(self.playButtonIconId_);
        if (self.tileRenderer_.ended()) {
            icon.setAttribute("data-feather", "rotate-ccw");
        } else if (self.tileRenderer_.paused()) {
            icon.setAttribute("data-feather", "play");
        } else {
            icon.setAttribute("data-feather", "pause");
        }

        feather.replace();
    }

    togglePlay_() {
        const self = this;

        // Update play state.
        if (self.tileRenderer_.paused()) {
            self.log_("Attempting to play");
            self.tileRenderer_.play();
        } else {
            self.log_("Attempting to pause");
            self.tileRenderer_.pause();
        }
    }

    // Toggle mute by updating the volume slider's position.
    onVolumeButtonClicked_() {
        const self = this;
        if (self.volumeSlider_ != null) {
            const volume = self.getVolume_();
            if (volume > 0) {
                self.volumeSlider_.value = 0
            } else {
                self.volumeSlider_.value = self.initialVolume_;
            }
            console.log(volume);
            self.updateVolume_();
        }
    }

    // Change the volume and then set it back in order to convince Safari that
    // the media has been interacted with (to allow autoplay).
    volumeHack_() {
        const self = this;
        if (!self.hasInteractedWithMedia_) {
            const volume = self.getVolume_();

            // Pick a new volume that is slightly different than the current
            // volume, making sure to not go out of the allowed bounds.
            let newVolume = volume + 0.1;
            if (newVolume > 1.0) {
                newVolume = volume - 0.1;
            }

            self.tileRenderer_.setVolume(newVolume);
            self.tileRenderer_.setVolume(volume);
            self.hasInteractedWithMedia_ = true;
        }
    }

    // Update the video volume based on the volume slider's position.
    updateVolume_() {
        const self = this;
        if (self.volumeSlider_ != null) {
            const volume = self.getVolume_();
            self.tileRenderer_.setVolume(volume);
            self.tileRenderer_.setMuted(volume == 0);
            self.updateVolumeUI_();

            // Cache the volume so it can be restored when toggling mute.
            if (volume > 0) {
                self.initialVolume_ = self.volumeSlider_.value;
            }
        }
    }

    // Update the volume icon to reflect the current volume level (or mute).
    updateVolumeUI_() {
        const self = this;
        if (self.volumeButtonIconId_ != null) {
            const volumeButtonIcon = document.getElementById(self.volumeButtonIconId_);
            const volume = self.getVolume_();
            if (volume == 0.0) {
                volumeButtonIcon.setAttribute("data-feather", "volume-x");
            } else if (volume < 0.5) {
                volumeButtonIcon.setAttribute("data-feather", "volume-1");
            } else {
                volumeButtonIcon.setAttribute("data-feather", "volume-2");
            }

            feather.replace();
        }
    }

    // Return the normalized volume. The video element expects
    // volume values between 0 and 1.
    getVolume_() {
        const self = this;
        if (self.volumeSlider_ != null) {
            const volume = self.volumeSlider_.value;
            const min = self.volumeSlider_.min;
            const max = self.volumeSlider_.max;
            return (volume - min) / (max - min);
        }

        return 0.0;
    }

    onWheelCanvas_(event) {
        const self = this;
        self.cameraControl_.zoom(event.deltaY > 0 ? -1 : +1);
        event.preventDefault();
        event.stopPropagation();
    }

    onLeftMouseUp_() {
        const self = this;
        self.cameraControl_.onLeftMouseUp();
    }

    onMouseDownCanvas_(event) {
        const self = this;
        if (event.button === 0) {
            // Make sure the logo gets hidden when the player is first interacted with.
            self.setGestureLogoVisible_(false);

            self.cameraControl_.onLeftMouseDown(event.x, event.y);
        } else {
            // Cancel any drags if a mouse button other than
            // the left button was pressed.
            self.onLeftMouseUp_();
        }
    }

    onMouseUpCanvas_(event) {
        const self = this;
        if (event.button === 0) {
            self.onLeftMouseUp_();
        }
    }

    onLeftMouseMove_(x, y) {
        const self = this;
        self.cameraControl_.onLeftMouseMove(x, y);
    }

    onMouseMoveCanvas_(event) {
        const self = this;
        if (event.button === 0) {
            self.onLeftMouseMove_(event.x, event.y);
        }
    }

    onMouseLeaveCanvas_(event) {
        const self = this;
        if (event.button === 0) {
            // If the mouse leaves the canvas, fire the mouse-up event to end
            // any drag that was in progress.
            self.onLeftMouseUp_();
        }
    }

    onTouchStartCanvas_(event) {
        // Do not call event.preventDefault(). This allows emulated mouse
        // events to fire so that, for example, links continue to work.

        const self = this;

        // Make sure the logo gets hidden when the player is first interacted with.
        self.setGestureLogoVisible_(false);

        const numTouches = event.targetTouches.length;
        if (numTouches === 1) {
            const target = event.targetTouches[0];
            self.cameraControl_.onLeftMouseDown(target.clientX, target.clientY);
        } else if (numTouches >= 2) {
            const target0 = event.targetTouches[0];
            const target1 = event.targetTouches[numTouches - 1];
            const dx = target1.clientX - target0.clientX;
            const dy = target1.clientY - target0.clientY;
            self.wheelSpan_ = Math.sqrt(dx * dx + dy * dy);
        }
    }

    onTouchEndCanvas_(event) {
        event.preventDefault();
        const self = this;
        self.onLeftMouseUp_();
    }

    onTouchMoveCanvas_(event) {
        event.preventDefault();
        const self = this;
        const numTouches = event.targetTouches.length;
        if (numTouches === 1) {
            const target = event.targetTouches[0];
            self.onLeftMouseMove_(target.clientX, target.clientY);
        } else if (numTouches >= 2) {
            const target0 = event.targetTouches[0];
            const target1 = event.targetTouches[numTouches - 1];
            const dx = target1.clientX - target0.clientX;
            const dy = target1.clientY - target0.clientY;
            const wheelSpan = Math.sqrt(dx * dx + dy * dy);
            if (wheelSpan !== self.wheelSpan_) {
                self.cameraControl_.zoom(wheelSpan > self.wheelSpan_ ? -1 : 1);
                self.wheelSpan_ = wheelSpan;
            }
        }
    }

    onTouchCancelCanvas_(event) {
        event.preventDefault();
        const self = this;
        self.onLeftMouseUp_();
    }

    log_(message) {
        console.log(message);
    }
}

window.addEventListener('DOMContentLoaded', (event) => {
    // Optionally set the player name.
    Omniweb.setPlayerInfo("GUI Player");

    feather.replace();

    const canvasId = "canvasId";
    const playButtonId = "playButtonId";
    const playButtonIconId = "playButtonIconId";
    const volumeButtonId = "volumeButtonId";
    const volumeButtonIconId = "volumeButtonIconId";
    const volumeSliderId = "volumeSliderId";
    const gestureLogoId = "centeredLogoId";
    const spinnerId = "spinnerId";
    const invalidClipId = "invalidClipId";
    const browserSupportId = "browserSupportId";
    const brandLogoId = "brandLogoId";

    const urlParams = new URLSearchParams(window.location.search);

    // Load a clip either by Clip ID or by Video and Bytes URLs.

    // Parse the clip ID from the search parameters.
    const clipIdParam = "clipId";
    let clipId = null;
    if (urlParams.has(clipIdParam)) {
        clipId = urlParams.get(clipIdParam);
    }

    // Parse video, bytes, and metadata URLs from the search parameters.
    const videoUrlParam = "videoUrl";
    const bytesUrlParam = "bytesUrl";
    const metadataUrlParam = "metadataUrl";
    let videoUrl = null;
    let bytesUrl = null;
    let metadataUrl = null;
    if (urlParams.has(videoUrlParam) && urlParams.has(bytesUrlParam)) {
        videoUrl = urlParams.get(videoUrlParam);
        bytesUrl = urlParams.get(bytesUrlParam);

        // Optional metadata URL.
        if (urlParams.has(metadataUrlParam)) {
            metadataUrl = urlParams.get(metadataUrlParam);
        }
    }

    // Parse background color from search parameters, defaulting to black.
    const bgColorParam = "bgColor";
    const defaultbgColor = [0, 0, 0, 1];
    let bgColor = defaultbgColor;
    if (urlParams.has(bgColorParam)) {
        const bgColorString = urlParams.get(bgColorParam);
        try {
            bgColor = JSON.parse(bgColorString);
            if (bgColor.length != 3) {
                // Fallback in case array is not a valid length
                bgColor = defaultbgColor;
            } else {
                // Append alpha value to bgColor
                bgColor.push(1);
                for (let i = 0; i < bgColor.length; i++) {
                    // Fallback in case array elements are not numbers
                    if (typeof bgColor[i] != "number" || bgColor[i] > 1.0 || bgColor[i] < 0.0) {
                        bgColor = defaultbgColor;
                        break;
                    }
                }
            }
        } catch (err) {
            // Fallback in case parameter is malformed
            bgColor = defaultbgColor;
        }
    }

    const autoplayParam = "autoplay";
    let autoplay = true;
    if (urlParams.has(autoplayParam)) {
        const autoplayString = urlParams.get(autoplayParam);
        autoplay = autoplayString.toLowerCase() == "true"; //Downside is everything else maps to false
    }

    const application = new Application(
        canvasId,
        playButtonId,
        playButtonIconId,
        volumeButtonId,
        volumeButtonIconId,
        volumeSliderId,
        gestureLogoId,
        spinnerId,
        invalidClipId,
        browserSupportId,
        brandLogoId,
        bgColor,
        autoplay,
        clipId,
        videoUrl,
        bytesUrl,
        metadataUrl);
});
