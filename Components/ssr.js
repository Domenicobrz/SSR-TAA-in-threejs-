import * as THREE from "three";
import DoubleRT from "./doubleRT";
import Utils from "./utils";

export default class SSR {
    constructor(renderer, sceneCamera, controls, normalRT, positionRT, depthRT, colorRT) {
        let sizeVector = new THREE.Vector2();
        renderer.getSize(sizeVector);
      
        // this.SSRRT = DoubleRT(sizeVector.x, sizeVector.y, THREE.LinearFilter);

        let rts = [];
        for(let i = 0; i < 2; i++) {
            let renderTarget = new THREE.WebGLMultipleRenderTargets(
                sizeVector.x * 1,
                sizeVector.y * 1,
                2
            );
            
            for ( let j = 0, il = renderTarget.texture.length; j < il; j ++ ) {
                renderTarget.texture[ j ].minFilter = THREE.NearestFilter;
                renderTarget.texture[ j ].magFilter = THREE.NearestFilter;
                renderTarget.texture[ j ].type = THREE.FloatType;
            }

            renderTarget.texture[ 0 ].name = 'ssrColor';
            renderTarget.texture[ 1 ].name = 'ssrUv';

            rts.push(renderTarget);
        }
        
        this.SSRRT = {
            read:  rts[0],
            write: rts[1],
            swap: function() {
                let temp   = this.read;
                this.read  = this.write;
                this.write = temp;
            },
            setSize: function(w, h) {
                rt1.setSize(w, h);
                rt2.setSize(w, h);
            },
        }



        this.material = new THREE.RawShaderMaterial({
            uniforms: {
                uTAA:          { type: "t", value: null },
                uOldSSRColor:  { type: "t", value: null },
                uOldSSRUv:     { type: "t", value: null },
                uPosition:     { type: "t", value: positionRT.texture },
                uDepth:        { type: "t", value: depthRT.texture },
                uNormal:       { type: "t", value: normalRT.texture },
                uColor:        { type: "t", value: colorRT.texture },
                uCameraPos:    { value: new THREE.Vector3(0,0,0) },
                uCameraTarget: { value: new THREE.Vector3(0,0,0) },
                uRandoms:      { value: new THREE.Vector4(0,0,0,0) },
            },
            
            vertexShader: `
                in vec3 position;
			    in vec3 normal;
			    in vec2 uv;

			    uniform mat4 modelViewMatrix;
			    uniform mat4 viewMatrix;
			    uniform mat4 projectionMatrix;
			    uniform mat3 normalMatrix;

                out vec2 vUv;
                out mat4 vProjViewMatrix;
                out mat4 vViewMatrix;

                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0); 

                    vProjViewMatrix = projectionMatrix * viewMatrix;
                    vViewMatrix = viewMatrix;
                }
            `,

            fragmentShader: `
                precision highp float;
			    precision highp int;

                layout(location = 0) out vec4 out_SSRColor;
			    layout(location = 1) out vec4 out_Uv;

                uniform sampler2D uPosition;
                uniform sampler2D uDepth;
                uniform sampler2D uNormal;
                uniform sampler2D uColor;
                uniform sampler2D uTAA;
                uniform sampler2D uOldSSRColor;
                uniform sampler2D uOldSSRUv;

                uniform vec3 uCameraPos;
                uniform vec3 uCameraTarget;
                uniform vec4 uRandoms;

                in vec2 vUv;
                in mat4 vProjViewMatrix;
                in mat4 vViewMatrix;

                float rand(float co) { return fract(sin(co*(91.3458)) * 47453.5453); }
                float rand(vec2 co){ return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
                float rand(vec3 co){ return rand(co.xy+rand(co.z)); }

                #define PI 3.14159
                #define texture2D texture

                float depthBufferAtP(vec3 p) {
                    vec4 projP = vProjViewMatrix * vec4(p, 1.0);
                    vec2 pNdc = (projP / projP.w).xy;
                    vec2 pUv  = pNdc * 0.5 + 0.5;
                    float depthAtPointP = texture2D(uDepth, pUv).x;
                    if(depthAtPointP == 0.0) depthAtPointP = 9999999.0; 

                    return depthAtPointP;
                }


                // functions taken from:
                // https://computergraphics.stackexchange.com/questions/7656/importance-sampling-microfacet-ggx

                // // https://schuttejoe.github.io/post/ggximportancesamplingpart1/
                // // https://agraphicsguy.wordpress.com/2015/11/01/sampling-microfacet-brdf/
                // func (m Microfacet) Sample(wo geom.Direction, rnd *rand.Rand) geom.Direction {
                //     r0 := rnd.Float64()
                //     r1 := rnd.Float64()
                //     a := m.Roughness * m.Roughness
                //     a2 := a * a
                //     theta := math.Acos(math.Sqrt((1 - r0) / ((a2-1)*r0 + 1)))
                //     phi := 2 * math.Pi * r1
                //     x := math.Sin(theta) * math.Cos(phi)
                //     y := math.Cos(theta)
                //     z := math.Sin(theta) * math.Sin(phi)
                //     wm := geom.Vector3{x, y, z}.Unit()
                //     wi := wo.Reflect2(wm)
                //     return wi
                // }
                
                vec3 SampleBRDF(vec3 wo, vec3 norm, int isample) {
                    float r0 = rand(float(isample) * 19.77 + uRandoms.x + wo);
                    float r1 = rand(float(isample) * 19.77 + uRandoms.x + wo + vec3(19.8879, 213.043, 67.732765));
                    float roughness = 0.15;
                    float a = roughness * roughness;
                    float a2 = a * a;
                    float theta = acos(sqrt((1.0 - r0) / ((a2 - 1.0 ) * r0 + 1.0)));
                    float phi = 2.0 * PI * r1;
                    float x = sin(theta) * cos(phi);
                    float y = cos(theta);
                    float z = sin(theta) * sin(phi);
                    vec3 wm = normalize(vec3(x, y, z));

                    vec3 w = norm;
                    if(abs(norm.y) < 0.95) {
                        vec3 u = normalize(cross(w, vec3(0.0, 1.0, 0.0)));
                        vec3 v = normalize(cross(u, w));
                        wm = normalize(wm.y * w + wm.x * u + wm.z * v);                    
                    } else {
                        vec3 u = normalize(cross(w, vec3(0.0, 0.0, 1.0)));
                        vec3 v = normalize(cross(u, w));
                        wm = normalize(wm.y * w + wm.x * u + wm.z * v);
                    }

                    vec3 wi = reflect(wo, wm);
                    return wi;
                }
                    

                // // https://schuttejoe.github.io/post/ggximportancesamplingpart1/
                // // https://agraphicsguy.wordpress.com/2015/11/01/sampling-microfacet-brdf/
                // // https://en.wikipedia.org/wiki/List_of_common_coordinate_transformations#From_Cartesian_coordinates_2
                // func (m Microfacet) PDF(wi, wo geom.Direction) float64 {
                //     wg := geom.Up
                //     wm := wo.Half(wi)
                //     a := m.Roughness * m.Roughness
                //     a2 := a * a
                //     cosTheta := wg.Dot(wm)
                //     exp := (a2-1)*cosTheta*cosTheta + 1
                //     D := a2 / (math.Pi * exp * exp)
                //     return (D * wm.Dot(wg)) / (4 * wo.Dot(wm))
                // }


                // // http://graphicrants.blogspot.com/2013/08/specular-brdf-reference.html
                // func (m Microfacet) Eval(wi, wo geom.Direction) rgb.Energy {
                //     wg := geom.Up
                //     wm := wo.Half(wi)
                //     if wi.Y <= 0 || wi.Dot(wm) <= 0 {
                //         return rgb.Energy{0, 0, 0}
                //     }
                //     F := fresnelSchlick(wi, wg, m.F0.Mean()) // The Fresnel function
                //     D := ggx(wi, wo, wg, m.Roughness)        // The NDF (Normal Distribution Function)
                //     G := smithGGX(wo, wg, m.Roughness)       // The Geometric Shadowing function
                //     r := (F * D * G) / (4 * wg.Dot(wi) * wg.Dot(wo))
                //     return m.F0.Scaled(r)
                // }

                void main() {
                    vec3 pos    = texture2D(uPosition, vUv).xyz;
                    float depth = texture2D(uDepth, vUv).x;
                    vec3 norm   = texture2D(uNormal, vUv).xyz;
                    vec4 col    = texture2D(uColor, vUv);

                    vec3 viewDir = normalize(pos - uCameraPos);
                   

                    vec3 w = normalize(uCameraTarget - uCameraPos);

                    if(dot(viewDir, norm) > 0.0) norm = -norm;

                    if(depth == 0.0) {
                        out_SSRColor = vec4(0.0, 0.0, 0.0, 1.0);
                        return;
                    }


                  


                    // float startingStep = 0.05;
                    // float stepMult = 1.25;
                    // const int steps = 40;
                    // const int binarySteps = 7;

                    bool jitter = false;
                    float startingStep = 0.05;
                    float stepMult = 1.15;
                    const int steps = 40;
                    const int binarySteps = 5;

                    vec4 taaBuffer = texture2D(uTAA, vUv);
                    vec2 oldUvs    = taaBuffer.xy;
                    float accum    = min(taaBuffer.z, 10.0);
                   
                    vec3 specularReflectionDir = normalize(reflect(viewDir, norm));
                    vec4 sum = vec4(0.0);

                    int samples = 5;
                    for(int s = 0; s < samples; s++) {
                        vec3 reflDir = SampleBRDF(viewDir, norm, s);
                        
                        vec3 rd = reflDir;
                        vec3 ro = pos + reflDir * max(0.01, 0.01 * depth);
                     
                        vec3 mult = vec3(1.0);
                        float maxIntersectionDepthDistance = 1.5;
                        mult *= max(dot(rd, norm), 0.0);
    
                        float step = startingStep;
    
                        vec3 p = ro;
                        bool intersected = false;
    
                        vec3 p1, p2;
                        float lastRecordedDepthBuffThatIntersected;
    
                        for(int i = 0; i < steps; i++) {
                            vec3 initialP = p;
                            
                            // at the end of the loop, we'll advance p by jittB to keep the jittered sampling in the proper "cell" 
                            float jittA = 0.5 + rand(p) * 0.5;
                            if(!jitter) jittA = 1.0;
                            float jittB = 1.0 - jittA;
    
                            p += rd * step * jittA;
    
                            vec4 projP = vProjViewMatrix * vec4(p, 1.0);
                            vec2 pNdc = (projP / projP.w).xy;
                            vec2 pUv  = pNdc * 0.5 + 0.5;
                            float depthAtPosBuff = texture2D(uDepth, pUv).x;
                            
    
                            if(depthAtPosBuff == 0.0) {
                                depthAtPosBuff = 9999999.0;
                            } 
    
                            // out of screen bounds condition
                            if(pUv.x < 0.0 || pUv.x > 1.0 || pUv.y < 0.0 || pUv.y > 1.0) {
                                // out_SSRColor = vec4(1.0, 0.0, 0.0, 1.0);
                                // return;
                                break;
                            }
    
                            float depthAtPointP = - (vViewMatrix * vec4(p, 1.0)).z;
                            if(depthAtPointP > depthAtPosBuff) {
                                // intersection found!
                                p1 = initialP;
                                p2 = p;
                                lastRecordedDepthBuffThatIntersected = depthAtPosBuff;
                              
                                break;
                            }
    
    
                            p += rd * step * jittB;
                            step *= stepMult; // this multiplication obviously need to appear AFTER we add jittB
                        }
    
    
                        // stranamente mi trovo a dover spostare la binary search fuori dal primo loop, altrimenti
                        // per qualche motivo esoterico la gpu inizia a prendere fuoco
    
                        // ******** binary search start *********
                        for(int j = 0; j < binarySteps; j++) {
                            vec3 mid = (p1 + p2) * 0.5;
                            float depthAtMid = - (vViewMatrix * vec4(mid, 1.0)).z;
                            float depthAtPosBuff = depthBufferAtP(mid);
                            if(depthAtMid > depthAtPosBuff) {
                                p2 = (p1 + p2) * 0.5;
                                // we need to save this value inside this if-statement otherwise if it was outside and above this
                                // if statement, it would be possible that it's value would be very large (e.g. if p1 intersected the "background"
                                // since in that case positionBufferAtP() returns viewDir * 99999999.0)
                                // and if that value is very large, it can create artifacts when evaluating this condition:
                                // ---> if(abs(distanceFromCameraAtP2 - lastRecordedDepthBuffThatIntersected) < maxIntersectionDepthDistance) 
                                // to be honest though, these artifacts only appear for largerish values of maxIntersectionDepthDistance
                                lastRecordedDepthBuffThatIntersected = depthAtPosBuff;
                            } else {
                                p1 = (p1 + p2) * 0.5;
                            }
                        }
                        // ******** binary search end   *********
    
                        // use p2 as the intersection point
                        float depthAtP2 = - (vViewMatrix * vec4(p2, 1.0)).z;
                        vec2 p2Uv;
                        if(abs(depthAtP2 - lastRecordedDepthBuffThatIntersected) < maxIntersectionDepthDistance) {
                            // intersection validated
                            // get normal & material at p2
                            vec4 projP2 = vProjViewMatrix * vec4(p2, 1.0);
                            p2Uv = (projP2 / projP2.w).xy * 0.5 + 0.5;
                            vec3 color = texture2D(uColor, p2Uv).xyz;
                            mult *= color;
                            intersected = true;
                        } else {
                            // intersection is invalid
                            mult = vec3(0.0);
                        }
                    

                        bool useTAA = true;
                        vec3 newCol;
                        vec4 fragCol = vec4(0.0);
    
                        if(useTAA) {
                            float t = (accum * 0.1) * 0.95;

                            vec3 oldSpecularDir = normalize(texture2D(uOldSSRUv, vUv + taaBuffer.xy).xyz);
                            float specDot = dot(oldSpecularDir, specularReflectionDir);
                            
                            // if(specDot < 0.9998) {
                            //     t = (specDot - 0.9998) / 0.0002;
                            //     t = clamp(t, 0.0, 1.0);
                            // }

                            // float del = 0.999995;
                            // float idel = 1.0 - del;
                            // if(specDot < del) {
                            //     // t = (specDot - del) / idel;
                            //     // t = clamp(t, 0.0, 1.0);
                            //     mult *= 0.9;
                            //     t *= 0.5;
                            // }

                            // if we moved the camera too much, lower t (taaBuffer has momentMove in uv space) 
                            float dist = clamp(length(taaBuffer.xy) / 0.01, 0.0, 1.0);
                            t *= 1.0 - dist;

                            vec3 oldSSR = texture2D(uOldSSRColor, vUv + taaBuffer.xy).xyz;
                            newCol = mult * (1.0 - t) + oldSSR * t;

                            if(intersected) {
                                sum += vec4(newCol, 0.0);
                            } else if(accum > 0.0) {
                                sum += vec4(oldSSR * 0.75, 0.0);
                            }
                        } else {
                            newCol = mult;
                        
                            if(intersected) {
                                sum += vec4(newCol, 0.0);
                            }
                        }
                    }

                    sum /= float(samples);

                    out_SSRColor = vec4(sum.xyz, 1.0);
                    out_Uv       = vec4(specularReflectionDir, 1.0);
                }
            `,
            glslVersion: THREE.GLSL3,
            depthTest:  false,
            depthWrite: false,
        });


        this.applySSRMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uSSR: { type: "t", value: null },
                uColor: { type: "t", value: colorRT.texture },
            },
            
            vertexShader: `
                varying vec2 vUv;

                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0); 
                }
            `,

            fragmentShader: `
                uniform sampler2D uSSR;
                uniform sampler2D uColor;

                varying vec2 vUv;

                void main() {
                    vec3 ssr = texture2D(uSSR, vUv).xyz;
                    vec3 col = texture2D(uColor, vUv).xyz;

                    gl_FragColor = vec4(col + ssr, 1.0);
                }
            `,

            depthTest:  false,
            depthWrite: false,
        });

        this.mesh = new THREE.Mesh(new THREE.PlaneBufferGeometry(2,2), this.material);
        this.renderer = renderer;

        this.scene = new THREE.Scene();
        this.scene.add(this.mesh);

        this.sceneCamera = sceneCamera;
        this.controls = controls;
    }

    compute(TAART) {
        this.SSRRT.swap();
        this.renderer.setRenderTarget(this.SSRRT.write);

        this.mesh.material = this.material;
        this.material.uniforms.uCameraPos.value = this.sceneCamera.position;
        this.material.uniforms.uCameraTarget.value = this.controls.target;
        this.material.uniforms.uOldSSRColor.value = this.SSRRT.read.texture[0];
        this.material.uniforms.uOldSSRUv.value    = this.SSRRT.read.texture[1];
        this.material.uniforms.uTAA.value = TAART;
        this.material.uniforms.uRandoms.value = new THREE.Vector4(Math.random(), Math.random(), Math.random(), Math.random());
        this.renderer.render(this.scene, this.sceneCamera);

        this.renderer.setRenderTarget(null);
    }

    apply(renderTargetDest) {
        this.renderer.setRenderTarget(renderTargetDest);

        this.mesh.material = this.applySSRMaterial;
        this.applySSRMaterial.uniforms.uSSR.value = this.SSRRT.write.texture[0];
        this.renderer.render(this.scene, this.sceneCamera);

        this.renderer.setRenderTarget(null);
    }
}