import * as THREE from "three";

export default class SSR {
    constructor(renderer, sceneCamera, controls, normalRT, positionRT, depthRT, colorRT) {
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uPosition:     { type: "t", value: positionRT.texture },
                uDepth:        { type: "t", value: depthRT.texture },
                uNormal:       { type: "t", value: normalRT.texture },
                uColor:        { type: "t", value: colorRT.texture },
                uCameraPos:    { value: new THREE.Vector3(0,0,0) },
                uCameraTarget: { value: new THREE.Vector3(0,0,0) },
            },
            
            vertexShader: `
                varying vec2 vUv;
                varying mat4 vProjViewMatrix;
                varying mat4 vViewMatrix;

                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0); 

                    vProjViewMatrix = projectionMatrix * viewMatrix;
                    vViewMatrix = viewMatrix;
                }
            `,

            fragmentShader: `
                uniform sampler2D uPosition;
                uniform sampler2D uDepth;
                uniform sampler2D uNormal;
                uniform sampler2D uColor;

                uniform vec3 uCameraPos;
                uniform vec3 uCameraTarget;

                varying vec2 vUv;
                varying mat4 vProjViewMatrix;
                varying mat4 vViewMatrix;

                float rand(float co) { return fract(sin(co*(91.3458)) * 47453.5453); }
                float rand(vec2 co){ return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
                float rand(vec3 co){ return rand(co.xy+rand(co.z)); }

                float depthBufferAtP(vec3 p) {
                    vec4 projP = vProjViewMatrix * vec4(p, 1.0);
                    vec2 pNdc = (projP / projP.w).xy;
                    vec2 pUv  = pNdc * 0.5 + 0.5;
                    float depthAtPointP = texture2D(uDepth, pUv).x;
                    if(depthAtPointP == 0.0) depthAtPointP = 9999999.0; 

                    return depthAtPointP;
                }

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

                void main() {
                    vec3 pos   = texture2D(uPosition, vUv).xyz;
                    float depth = texture2D(uDepth, vUv).x;
                    vec3 norm  = texture2D(uNormal, vUv).xyz;
                    vec4 col   = texture2D(uColor, vUv);

                    vec3 viewDir = normalize(pos - uCameraPos);
                    vec3 reflDir = normalize(reflect(viewDir, norm));
                    vec3 w = normalize(uCameraTarget - uCameraPos);

                    if(dot(viewDir, norm) > 0.0) norm = -norm;

                    if(depth == 0.0) {
                        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
                        return;
                    }

                    vec3 rd = reflDir;
                    vec3 ro = pos + reflDir * max(0.01, 0.01 * depth);

                 
                    vec3 mult = vec3(1.0);
                    float maxIntersectionDepthDistance = 1.5;
                    mult *= max(dot(rd, norm), 0.0);


                    // float startingStep = 0.05;
                    // float stepMult = 1.25;
                    // const int steps = 40;
                    // const int binarySteps = 7;

                    bool jitter = false;
                    float startingStep = 0.05;
                    float stepMult = 1.15;
                    const int steps = 40;
                    const int binarySteps = 5;

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
                            // gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
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
                    if(abs(depthAtP2 - lastRecordedDepthBuffThatIntersected) < maxIntersectionDepthDistance) {
                        // intersection validated
                        // get normal & material at p2
                        vec4 projP2 = vProjViewMatrix * vec4(p2, 1.0);
                        vec2 p2Uv = (projP2 / projP2.w).xy * 0.5 + 0.5;
                        vec3 color = texture2D(uColor, p2Uv).xyz;
                        mult *= color;
                        intersected = true;
                    } else {
                        // intersection is invalid
                    }



                    vec4 fragCol = col;

                    if(intersected) {
                        fragCol += vec4(mult, 0.0);
                    }

                    gl_FragColor = fragCol;
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

    compute(renderTargetDest) {
        this.renderer.setRenderTarget(renderTargetDest);

        this.material.uniforms.uCameraPos.value = this.sceneCamera.position;
        this.material.uniforms.uCameraTarget.value = this.controls.target;
        this.renderer.render(this.scene, this.sceneCamera);

        this.renderer.setRenderTarget(null);
    }
}