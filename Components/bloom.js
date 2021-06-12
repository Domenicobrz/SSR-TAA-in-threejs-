import * as THREE from "three";
import Blit from "./blit";
import Utils from "./utils";

/**
    USAGE EXAMPLE:

    bloomProgram = new Bloom(renderer, camera, scene, { iterations: 5 });

    function render() {
 		bloomProgram.threshold        = GUIcontrols.bloomThreshold;
		bloomProgram.softThreshold    = GUIcontrols.bloomSoftThreshold;
		bloomProgram.strength         = GUIcontrols.bloomStrength;
		bloomProgram.blurKernelOffset = GUIcontrols.bloomBlurKernelOffset;
		bloomProgram.compute(renderTarget, outputTarget);
    }

    - - - - - - - - - - - - - - - - 

    * * * better solution in the paragraph below this one * * * 
    if you're applying tonemapping after the bloom and you start to see a non-smooth blurring (banding artifacts)
    after setting the exposure to a higher value, then you should experiment with raising the computed bloom
    to an exponent so that after the tonemapping step the curve can be smoothed a bit  

    * * * here's the better solution: * * *
    Another option that seems to solve the problem completely:
        keep the tonemapping exposure to values close to 1 and adjust the lighting of your scene,
        this will make sure that the tonemapping curve wont move dimly lit pixels high enough to 
        create banding artifacts.
        If a pixel receives very little radiance, and the exposure is set to a high value,
        it will be brightened upward (a lot) with a curve that will create banding artifacts
        and remove the smoothness of the gaussian blur  

        also keep in mind that threejs's ACES filmic exposure (and also the exposure in my custom tonemapping component)
        is by default set to (user_supplied_exposure / 0.6) so it's higher than it should be by default
*/

export default class Bloom {
    constructor(renderer, camera, scene, args) {
        this.iterations       = args.iterations      || 3;
        this.downSampleDelta  = args.downSampleDelta || 0.5;
        this.upSampleDelta    = args.upSampleDelta   || 0.5;
        this.strength         = args.strength || 1;
        this.threshold        = args.threshold || 0;
        this.softThreshold    = args.softThreshold || 0.5;
        this.blurKernelOffset = args.blurKernelOffset || 1.5;

        this.rts = [];
        this.updateRts(renderer.domElement.clientWidth, renderer.domElement.clientHeight);

	    this.blitProgram = new Blit(renderer);

        this.downSampleMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTexture:       { type: "t", value: null },
                uUVPixelSize:   { value: new THREE.Vector2(1 / renderer.domElement.clientWidth, 1 / renderer.domElement.clientHeight) },
                uDelta:         { value: 1 },
                uThreshold:     { value: 0 },
                uSoftThreshold: { value: 0 },
            },
            
            vertexShader: `
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);    
                }
            `,

            fragmentShader: `
                uniform sampler2D uTexture;
                uniform vec2 uUVPixelSize;
                uniform float uDelta;
                uniform float uThreshold;
                uniform float uSoftThreshold;

                varying vec2 vUv;

                void main() {
                    // technique: downsampling by 4x4 box - https://catlikecoding.com/unity/tutorials/advanced-rendering/bloom/

                    // "floor" uvs to 0,0 coordinate relative to this pixel
                    vec2 uvs = vUv;
                    // vec2 offs = mod(uvs, uUVPixelSize);
                    // uvs -= offs;

                    vec4 s0 = texture2D(uTexture, uvs + uUVPixelSize * vec2(+uDelta, +uDelta)); 
                    vec4 s1 = texture2D(uTexture, uvs + uUVPixelSize * vec2(-uDelta, +uDelta)); 
                    vec4 s2 = texture2D(uTexture, uvs + uUVPixelSize * vec2(+uDelta, -uDelta)); 
                    vec4 s3 = texture2D(uTexture, uvs + uUVPixelSize * vec2(-uDelta, -uDelta)); 

                    vec3 col = (s0 + s1 + s2 + s3).rgb * 0.25;
                    // float brightness = max(col.r, max(col.g, col.b));
                    // float contribution = max(brightness - uThreshold, 0.0) / max(brightness, 0.0001   /* to avoid division by zero */);
                    // col *= contribution;

                    float brightness = length(col.rgb); // max(col.r, max(col.g, col.b));
			        float knee = uThreshold * uSoftThreshold;
			        float soft = brightness - uThreshold + knee;
			        soft = clamp(soft, 0.0, 2.0 * knee);
			        soft = soft * soft / (4.0 * knee + 0.00001);
			        float contribution = max(soft, brightness - uThreshold);
			        contribution /= max(brightness, 0.00001);
                    col *= contribution;

                    gl_FragColor = vec4(col, 1.0);
                }
            `,

            depthTest:     false,
            depthWrite:    false,
        });

        this.gaussianMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uTexture:     { type: "t", value: null },
                uUVPixelSize: { value: new THREE.Vector2(1 / renderer.domElement.clientWidth, 1 / renderer.domElement.clientHeight) },
                uBlurKernelOffset: { value: this.blurKernelOffset },
            },
            
            vertexShader: `
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);    
                }
            `,

            fragmentShader: `
                uniform sampler2D uTexture;
                uniform vec2 uUVPixelSize;
                uniform float uBlurKernelOffset;

                float weight[9] = float[] (
                    1.0/16.0, 1.0/8.0, 1.0/16.0, 
                    1.0/8.0,  1.0/4.0, 1.0/8.0, 
                    1.0/16.0, 1.0/8.0, 1.0/16.0 
                );
                varying vec2 vUv;

                void main() {
                    vec2 tex_offset = uUVPixelSize * uBlurKernelOffset;
            
                    // apply 3x3 blur kernel
                    vec3 result = vec3(0.0); // current fragment's contribution
                    for(int i = -1; i <= 1; i++) {
                        for(int j = -1; j <= 1; j++) {
                            vec2 uvs = vUv + vec2(tex_offset.x * float(j), tex_offset.y * float(i));
                            result += texture(uTexture, uvs).rgb * weight[(i+1) * 3 + (j+1)];
                        }                     
                    }

                    gl_FragColor = vec4(result, 1.0);
                }
            `,

            depthTest:     false,
            depthWrite:    false,
        });

        this.combineMaterial =  new THREE.ShaderMaterial({
            uniforms: {
                uTexture1: { type: "t", value: null },
                uTexture2: { type: "t", value: null },
                uStrength: { value: this.strength },
            },
            
            vertexShader: `
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0);    
                }
            `,

            fragmentShader: `
                uniform sampler2D uTexture1;
                uniform sampler2D uTexture2;
                uniform float     uStrength;

                varying vec2 vUv;

                void main() {
                    vec3 bloom = texture2D(uTexture2, vUv).rgb;

                    vec3 col = texture2D(uTexture1, vUv).rgb + bloom * uStrength;
                    gl_FragColor = vec4(col, 1.0);
                }
            `,

            depthTest:  false,
            depthWrite: false,
        });

        Utils.onResize(renderer.domElement, (width, height) => {
            this.updateRts(width, height);
        });

        this.mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2,2), this.downSampleMaterial);
        this.camera = new THREE.PerspectiveCamera( 45, 1 /* remember that the camera is worthless here */, 1, 1000 );
        this.renderer = renderer;

        this.scene = new THREE.Scene();
        this.scene.add(this.mesh);
    }

    updateRts(width, height) {
        if(width === 0 || height === 0) throw new Error("requested framebuffer with null dimension");

        for(let i = 0; i < this.rts.length; i++) {
            this.rts[i].rt.dispose();
        }
        
        this.rts = [];

        let res = 0.5;
        for(let i = 0; i < this.iterations; i++) {
            let w = Math.floor(width  * res);
            let h = Math.floor(height * res);

            let rt = new THREE.WebGLRenderTarget(
                w, h,
                { type: THREE.FloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
            
            this.rts.push({ w, h, rt });
            res *= 0.5;
        }
    }

    // we're linearly adding bloom without performing any kind of tonemapping / gamma space correction
    compute(rtIn, rtOut) {
        this.mesh.material = this.downSampleMaterial;

        // downsample pass
        this.downSampleMaterial.uniforms.uDelta.value = this.downSampleDelta;
        this.downSampleMaterial.uniforms.uThreshold.value = this.threshold;
        this.downSampleMaterial.uniforms.uSoftThreshold.value = this.softThreshold;
        for(let i = 0; i < this.rts.length; i++) {

            if(i === 0) {
                this.downSampleMaterial.uniforms.uTexture.value = rtIn.texture;
                this.downSampleMaterial.uniforms.uUVPixelSize.value = new THREE.Vector2(1 / rtIn.texture.image.width, 1 / rtIn.texture.image.height);
            } else {
                this.downSampleMaterial.uniforms.uTexture.value = this.rts[i - 1].rt.texture;
                this.downSampleMaterial.uniforms.uUVPixelSize.value = new THREE.Vector2(1 / this.rts[i - 1].w, 1 / this.rts[i - 1].h);
            }

            this.renderer.setRenderTarget(this.rts[i].rt);
            this.renderer.render(this.scene, this.camera);
        }

        // upsample pass
        this.mesh.material = this.gaussianMaterial;
        this.gaussianMaterial.uniforms.uBlurKernelOffset.value = this.blurKernelOffset;
        for(let i = this.rts.length - 1; i >= 1; i--) {
            this.renderer.setRenderTarget(this.rts[i - 1].rt);
            
            this.gaussianMaterial.uniforms.uTexture.value     = this.rts[i].rt.texture;
            this.gaussianMaterial.uniforms.uUVPixelSize.value = new THREE.Vector2(1 / this.rts[i].w, 1 / this.rts[i].h);
            this.renderer.render(this.scene, this.camera);
        }

        // combination step
        this.mesh.material = this.combineMaterial;
        this.combineMaterial.uniforms.uTexture1.value = rtIn.texture;
        this.combineMaterial.uniforms.uTexture2.value = this.rts[0].rt.texture;
        this.combineMaterial.uniforms.uStrength.value = this.strength;
        this.renderer.setRenderTarget(rtOut);
        this.renderer.render(this.scene, this.camera);

        this.renderer.setRenderTarget(null);
    }
}