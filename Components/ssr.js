import * as THREE from "three";
import DoubleRT from "./doubleRT";
import Utils from "./utils";

export default class SSR {
    constructor(renderer, sceneCamera, controls, normalTexture, positionTexture, albedoTexture, materialTexture, colorRT, oldPosRT, oldNormRT, blueNoiseTexture) {
        let sizeVector = new THREE.Vector2();
        renderer.getSize(sizeVector);
      
        let postReflMult = "1.0";

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
                uTAA:            { type: "t", value: null },
                uOldSSRColor:    { type: "t", value: null },
                uOldSSRUv:       { type: "t", value: null },
                uOldPosition:    { type: "t", value: oldPosRT.texture },
                uPosition:       { type: "t", value: positionTexture },
                uOldNormal:      { type: "t", value: oldNormRT.texture },
                uNormal:         { type: "t", value: normalTexture },
                uAlbedo:         { type: "t", value: albedoTexture },
                uMaterial:       { type: "t", value: materialTexture },
                uColor:          { type: "t", value: colorRT.texture },
                uEnvmap:         { type: "t", value: null },
                uOldCameraPos:   { value: new THREE.Vector3(0,0,0) },
                uCameraPos:      { value: new THREE.Vector3(0,0,0) },
                uCameraTarget:   { value: new THREE.Vector3(0,0,0) },
                uRandoms:        { value: new THREE.Vector4(0,0,0,0) },
                uTime:           { value: 0 },
                uSamples:        { value: 2 },
                uUncompressedEnv: { value: false },
                uAccumTimeFactor: { value: 0.92 },
                uOldViewMatrix:  { value: new THREE.Matrix4() },
                uBlueNoise:      { type: "t", value: blueNoiseTexture },
                uBlueNoiseIndex: { value: new THREE.Vector4(0,0,0,0) },
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
                out mat4 vProjectionMatrix;
                out mat4 vViewMatrix;

                void main() {
                    vUv = uv;
                    gl_Position = vec4(position.xy, 0.0, 1.0); 

                    vProjViewMatrix = projectionMatrix * viewMatrix;
                    vViewMatrix = viewMatrix;
                    vProjectionMatrix = projectionMatrix;
                }
            `,

            fragmentShader: `
                precision highp float;
			    precision highp int;

                layout(location = 0) out vec4 out_SSRColor;
			    layout(location = 1) out vec4 out_SSRIntersection;

                uniform sampler2D uOldPosition;
                uniform sampler2D uPosition;
                uniform sampler2D uOldNormal;
                uniform sampler2D uNormal;
                uniform sampler2D uAlbedo;
                uniform sampler2D uMaterial;
                uniform sampler2D uColor;
                uniform sampler2D uTAA;
                uniform sampler2D uOldSSRColor;
                uniform sampler2D uOldSSRUv;
                uniform sampler2D uEnvmap;
                uniform sampler2D uBlueNoise;

                uniform int uSamples;
                uniform float uTime;
                uniform bool uUncompressedEnv;
                uniform float uAccumTimeFactor;
                uniform vec4 uBlueNoiseIndex;
                uniform vec3 uCameraPos;
                uniform vec3 uOldCameraPos;
                uniform vec3 uCameraTarget;
                uniform vec4 uRandoms;
                uniform mat4 uOldViewMatrix;

                in vec2 vUv;
                in mat4 vProjectionMatrix;
                in mat4 vProjViewMatrix;
                in mat4 vViewMatrix;

                float rand(float co) { return fract(sin(co*(91.3458)) * 47453.5453); }
                float rand(vec2 co)  { return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453); }
                float rand(vec3 co)  { return rand(co.xy+rand(co.z)); }

                #define PI 3.14159
                #define texture2D texture
                #ifndef saturate
                    #define saturate(a) clamp( a, 0.0, 1.0 )
                #endif

                vec3 proj_point_in_plane(vec3 p, vec3 v0, vec3 n, out float d) {
                    d = dot(n, p - v0);
                    return p - (n * d);
                }
                   
                vec3 find_reflection_incident_point(vec3 p0, vec3 p1, vec3 v0, vec3 n) {
                    float d0 = 0.0;
                    float d1 = 0.0;
                    vec3 proj_p0 = proj_point_in_plane(p0, v0, n, d0);
                    vec3 proj_p1 = proj_point_in_plane(p1, v0, n, d1);
        
                    if(d0 < d1)
                        return (proj_p0 - proj_p1) * d1/(d0+d1) + proj_p1;
                    else
                        return (proj_p1 - proj_p0) * d0/(d0+d1) + proj_p0;
                }

                float depthBufferAtP(vec3 p) {
                    vec4 projP = vProjViewMatrix * vec4(p, 1.0);
                    vec2 pNdc = (projP / projP.w).xy;
                    vec2 pUv  = pNdc * 0.5 + 0.5;
                    float depthAtPointP = texture2D(uPosition, pUv).w;
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
                
                vec3 SampleBRDF(vec3 wo, vec3 norm, int isample, float roughness, out vec3 out_wm) {
                    // float r0 = rand(float(isample) * 19.77 + uRandoms.x + wo);
                    // float r1 = rand(float(isample) * 19.77 + uRandoms.x + wo + vec3(19.8879, 213.043, 67.732765));

                    // vec2 blue_uvs = vec2(mod(gl_FragCoord.xy + mod(uTime * 20.0, 100.0) + uRandoms.xy * 589.79, 512.0) / 512.0);
                    // vec2 blue_uvs = vec2(mod(gl_FragCoord.xy + uRandoms.xy * 5809.79 + float(isample) * 19.77, 512.0) / 512.0);
                    vec2 blue_uvs = vec2((gl_FragCoord.xy + uBlueNoiseIndex.xy) / 512.0);
                    // blue_uvs = clamp(blue_uvs, vec2(0.0), vec2(0.99));
                    vec4 blue_noise = texture2D(uBlueNoise, blue_uvs);
                    
                    float r0 = blue_noise.x;
                    float r1 = blue_noise.y - 0.33;   // I have no idea why, but it looks like this blue noise distribution is a bit skewed,
                                                      // so I have to make this small correction

                    r0 = fract(r0 + float(isample) * 19.77);
                    r1 = fract(r1 + float(isample) * 27.337);
                                                                    
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
                    out_wm = wm;
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

                float samplePDF(vec3 wi, vec3 wo, vec3 norm, float roughness) {
                    vec3 wg = norm;
                    vec3 wm = normalize(wo + wi);
                    float a = roughness * roughness;
                    float a2 = a * a;
                    float cosTheta = dot(wg, wm);
                    float exp = (a2 - 1.0) * cosTheta * cosTheta + 1.0;
                    float D = a2 / (PI * exp * exp);
                    return (D * dot(wm, wg)) / (4.0 * dot(wo,wm));
                }

                vec3 fresnelSchlick(float cosTheta, vec3 F0) {
                    return F0 + (1.0 - F0) * pow(max(1.0 - cosTheta, 0.0), 5.0);
                }

                vec3 F_Schlick(float u, vec3 f0) {
                    float f = pow(1.0 - u, 5.0);
                    return f + f0 * (1.0 - f);
                }

                // // GGX Normal Distribution Function
                // // http://graphicrants.blogspot.com/2013/08/specular-brdf-reference.html
                // func ggx(in, out, normal geom.Direction, roughness float64) float64 {
                //     m := in.Half(out)
                //     a := roughness * roughness
                //     nm2 := math.Pow(normal.Dot(m), 2)
                //     return (a * a) / (math.Pi * math.Pow(nm2*(a*a-1)+1, 2))
                // }
                // 
                // // Smith geometric shadowing for a GGX distribution
                // // http://graphicrants.blogspot.com/2013/08/specular-brdf-reference.html
                // func smithGGX(out, normal geom.Direction, roughness float64) float64 {
                //     a := roughness * roughness
                //     nv := normal.Dot(out)
                //     return (2 * nv) / (nv + math.Sqrt(a*a+(1-a*a)*nv*nv))
                // }

                float DistributionGGX(vec3 N, vec3 H, float roughness) {
                    vec3 m = H;
                    float a = roughness * roughness;
                    float nm2 = pow(dot(N, H), 2.0);
                    return (a * a) / (PI * pow( nm2 * ( a * a - 1.0 ) + 1.0, 2.0));


                    // float a      = roughness*roughness;
                    // float a2     = a*a;
                    // float NdotH  = max(dot(N, H), 0.0);
                    // float NdotH2 = NdotH*NdotH;
                
                    // float num   = a2;
                    // float denom = (NdotH2 * (a2 - 1.0) + 1.0);
                    // denom = PI * denom * denom;
                
                    // return num / denom;
                }

                float DistributionGGXFilament(vec3 N, vec3 H, float roughness) {
                        // from filament
                    float NoH  = max(dot(N, H), 0.0);
                    float a = NoH * roughness;
                    float k = roughness / (1.0 - NoH * NoH + a * a);
                    return k * k * (1.0 / PI);
                }

                float GeometrySchlickGGX(float NdotV, float roughness) {
                    float r = (roughness + 1.0);
                    float k = (r*r) / 8.0;
                
                    float num   = NdotV;
                    float denom = NdotV * (1.0 - k) + k;
                
                    return num / denom;
                }
                
                float GeometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
                    float a = roughness * roughness;
                    float nv = dot(N, V);
                    return (2.0 * nv) / (nv + sqrt(a*a + (1.0 - a*a) * nv * nv ));
                    
                    
                    // float NdotV = max(dot(N, V), 0.0);
                    // float NdotL = max(dot(N, L), 0.0);
                    // float ggx2  = GeometrySchlickGGX(NdotV, roughness);
                    // float ggx1  = GeometrySchlickGGX(NdotL, roughness);
                
                    // return ggx1 * ggx2;
                }

                float V_SmithGGXCorrelatedFast(vec3 N, vec3 V, vec3 L, float roughness) {
                    float NoV = dot(N, V);
                    float NoL = dot(N, L);
                    float a = roughness;
                    float GGXV = NoL * (NoV * (1.0 - a) + a);
                    float GGXL = NoV * (NoL * (1.0 - a) + a);
                    return 0.5 / (GGXV + GGXL);
                }

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

                // http://graphicrants.blogspot.com/2013/08/specular-brdf-reference.html
                vec3 EvalBRDF(vec3 wi, vec3 wo, vec3 n, float roughness, vec3 F0) {
                    vec3 wm = normalize(wo + wi);
                    if (/* (wi.y <= 0.0) || */ dot(wi, wm) <= 0.0) {
                        return vec3(0.0);
                    }

                    vec3 F    = fresnelSchlick(max(dot(wm, wo), 0.0), F0);
                    float NDF = DistributionGGX(n, wm, roughness); 
                    float G   = GeometrySmith(n, wo, wi, roughness);   

                    // vec3 numerator    = NDF * G * F;
                    // float denominator = 4.0 * max(dot(n, wo), 0.0) * max(dot(n, wi), 0.0);
                    // vec3 specular     = numerator / max(denominator, 0.001);  
                    
                    vec3 specular = (F * NDF * G) / (4.0 * dot(wi, n) * dot(n,wo));
                    return F0 * specular;
                    // return specular;




                    // // from filament
                    // vec3 F    = F_Schlick(max(dot(wm, wo), 0.0), F0);
                    // float NDF = DistributionGGXFilament(n, wm, roughness); 
                    // float G   = V_SmithGGXCorrelatedFast(n, wo, wi, roughness);

                    // // specular BRDF
                    // vec3 Fr = (NDF * G) * F;

                    // return Fr;
                }

                vec3 RRTAndODTFit( vec3 v ) {
                    vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
                    vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
                    return a / b;
                }
                vec3 ACESFilmicToneMapping( vec3 color ) {
                    const mat3 ACESInputMat = mat3(
                    vec3( 0.59719, 0.07600, 0.02840 ), vec3( 0.35458, 0.90834, 0.13383 ), vec3( 0.04823, 0.01566, 0.83777 )
                    );
                    const mat3 ACESOutputMat = mat3(
                    vec3(  1.60475, -0.10208, -0.00327 ), vec3( -0.53108, 1.10813, -0.07276 ), vec3( -0.07367, -0.00605, 1.07602 )
                    );
                    float toneMappingExposure = 1.0;
                    color *= toneMappingExposure / 0.6;
                    color = ACESInputMat * color;
                    color = RRTAndODTFit( color );
                    color = ACESOutputMat * color;
                    return saturate( color );
                }

                vec4 RGBEToLinear( in vec4 value ) {
                    return vec4( value.rgb * exp2( value.a * 255.0 - 128.0 ), 1.0 );
                }

                vec3 getEnvmapRadiance(vec3 idir) {
                    vec3 dir = vec3(idir.zyx);

                    // skybox coordinates
                    vec2 skyboxUV = vec2(
                        (atan(dir.x, dir.z) + PI) / (PI * 2.0),
                        (asin(dir.y) + PI * 0.5) / (PI)
                    );
                    // vec3 radianceClamp = vec3(100.0);
                    vec3 col = vec3(0.0);
                    if(!uUncompressedEnv) {
                        col = ACESFilmicToneMapping(RGBEToLinear(texture2D(uEnvmap, skyboxUV)).xyz);
                        // vec3 col = RGBEToLinear(texture2D(uEnvmap, skyboxUV)).xyz;
                    } else {
                        col = ACESFilmicToneMapping(RGBEToLinear(texture2D(uEnvmap, skyboxUV)).xyz) * 0.55 + RGBEToLinear(texture2D(uEnvmap, skyboxUV)).xyz * 0.45;
                    }

                    // col = clamp(col, vec3(0.0), vec3(radianceClamp));
                    // col = pow(col, vec3(2.2)); 
                    return col;
                }

                bool intersect(
                    vec3 ro, vec3 rd, 
                    out vec3 intersectionP,
                    out vec3 lastP) 
                {
                    bool jitter = true;
                    float startingStep = 0.05;
                    float stepMult = 1.15;
                    const int steps = 40;
                    const int binarySteps = 5;

                    float maxIntersectionDepthDistance = 1.5;
                    float step = startingStep;

                    vec3 p = ro;
                    bool intersected = false;
                    bool possibleIntersection = false;
                    float lastRecordedDepthBuffThatIntersected;

                    vec3 p1, p2;
                    vec3 initialP = p;
                    for(int i = 0; i < steps; i++) {

                        // at the end of the loop, we'll advance p by jittB to keep the jittered sampling in the proper "cell" 
                        // float jittA = 0.5 + rand(p) * 0.5;
                        float jittA = fract(rand(p) + uRandoms.x);
                        if(!jitter) jittA = 1.0;
                        // jittA = 0.0;
                        float jittB = 1.0 - jittA;

                        p += rd * step * jittA;

                        vec4 projP = vProjViewMatrix * vec4(p, 1.0);
                        vec2 pNdc = (projP / projP.w).xy;
                        vec2 pUv  = pNdc * 0.5 + 0.5;
                        float depthAtPosBuff = texture2D(uPosition, pUv).w;

                        if(depthAtPosBuff == 0.0) {
                            depthAtPosBuff = 9999999.0;
                        } 

                        // out of screen bounds condition
                        if(pUv.x < 0.0 || pUv.x > 1.0 || pUv.y < 0.0 || pUv.y > 1.0) {
                            break;
                        }

                        float depthAtPointP = - (vViewMatrix * vec4(p, 1.0)).z;
                        if(depthAtPointP > depthAtPosBuff) {
                            // intersection found!
                            p1 = initialP;
                            p2 = p;
                            lastRecordedDepthBuffThatIntersected = depthAtPosBuff;
                            possibleIntersection = true;

                            break;
                        }

                        // initialP needs to be the last jittered sample, and can't just be the "p" value at the start
                        // of the loop iteration, otherwise you run the risk of having both p1 and p2 at the same side of the depth buffer
                        // and (apparently) for the binary search to work properly you need to have p1 and p2 on different sides of the depth buffer
                        // p1 at the side of the depth buffer plane that it's closer to the camera, and p2 at the other side
                        initialP = p;
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


                    intersectionP = p2;
                    lastP = p;

                    // use p2 as the intersection point
                    float depthAtP2 = - (vViewMatrix * vec4(p2, 1.0)).z;
                    if( possibleIntersection &&   // without using possibleIntersection apparently it's possible that lastRecordedDepthBuffThatIntersected
                                                  // ends up being valid thanks to the binary search, and that causes all sorts of troubles
                        abs(depthAtP2 - lastRecordedDepthBuffThatIntersected) < maxIntersectionDepthDistance) {
                        // intersection validated
                        intersected = true;
                    }

                    return intersected;
                }

                void main() {
                    vec4 posTexel = texture2D(uPosition, vUv);
                    vec3 pos      = posTexel.xyz;
                    float depth   = posTexel.w;
                    vec3 norm     = normalize(texture2D(uNormal, vUv).xyz);
                    vec4 col      = texture2D(uColor, vUv);
                    vec4 albedo   = texture2D(uAlbedo, vUv);
                    vec4 material = texture2D(uMaterial, vUv);

                    vec3 viewDir = normalize(pos - uCameraPos);
                   

                    vec3 w = normalize(uCameraTarget - uCameraPos);

                    if(dot(viewDir, norm) > 0.0) norm = -norm;

                    if(depth == 0.0) {
                        out_SSRColor = vec4(0.0, 0.0, 0.0, 1.0);
                        return;
                    }


                    float roughness = material.x;
                    float metalness = material.y;
                    float baseF0    = material.z;


                    vec4 taaBuffer = texture2D(uTAA, vUv);
                    vec2 oldUvs    = taaBuffer.xy;
                    float accum    = min(taaBuffer.z, 10.0);

                    float det = min(length(uOldCameraPos - uCameraPos) * 0.35, 0.65);
                    // since the reflection-reprojection method (mentioned as oldSSR1 later) of accumulating previous values 
                    // tends to blur the result over time,
                    // we're trying to reduce the roughness such that the perceived difference between the two methods is minimal 
                    // we're only applying this fix between roughness in [0.2 ... 0.4] since it works best in that range
                    // if(roughness > 0.2 && roughness < 0.4 && det > 0.5) roughness *= 0.75;
                    if(roughness > 0.2) {
                        roughness *= 1.0 - (det / 0.6) * 0.3;
                    }
                   
                    vec3 specularReflectionDir = normalize(reflect(viewDir, norm));
                    vec4 sum = vec4(0.0);

                    vec4 intersectionPointAverage = vec4(0.0);
                    float intersectionPointAverageSamples = 0.0; // I can't just reference "samples" since some sample might fail
                    int samples = uSamples;
                    int effectiveSamples = samples;
                    for(int s = 0; s < samples; s++) {
                        vec3 wm;
                        vec3 reflDir = SampleBRDF(viewDir, norm, s, roughness, wm);
                        reflDir = normalize(reflDir);
                        
                        // unfortunately, this even seems very common after a set roughness level
                        if(dot(reflDir, norm) < 0.0) {
                            if(effectiveSamples > 1) {
                                // skip this sample entirely
                                --effectiveSamples;
                                continue;
                            } else {
                                // one last attempt, and whatever happens happens
                                reflDir = SampleBRDF(viewDir, norm, s + 79, roughness, wm);
                            }
                        }

                        vec3 rd = reflDir;
                        vec3 ro = pos + reflDir * max(0.01, 0.01 * depth);
                     
                        vec3 mult = vec3(1.0);
                        float maxIntersectionDepthDistance = 1.5;
                        mult *= max(dot(rd, norm), 0.0);
    

                        vec3 p2;
                        vec3 lastP;
                        bool intersected = intersect(ro, rd, p2, lastP);

                        vec3 F0 = vec3(baseF0);
                        F0 = mix(F0, albedo.xyz, metalness);

                        vec2 p2Uv;
                        if(intersected) {
                            // intersection validated
                            vec4 projP2 = vProjViewMatrix * vec4(p2, 1.0);
                            p2Uv = (projP2 / projP2.w).xy * 0.5 + 0.5;
                            vec3 color = texture2D(uColor, p2Uv).xyz;
                            // vec3 color = texture2D(uAlbedo, p2Uv).xyz;
                            mult *= color;
                            
                            // apply pdf and brdf
                            vec3 brdf = EvalBRDF(rd, -viewDir, norm, roughness, F0);
                            float pdf = samplePDF(rd, -viewDir, norm, roughness);

                            brdf = clamp(brdf, 0.00001, 1000.0);
                            pdf  = clamp(pdf,  0.00001, 1000.0);

                            mult *= brdf;
                            mult /= max(pdf, 0.0000000000001);

                            intersectionPointAverage += vec4(p2, 1.0);
                            intersectionPointAverageSamples += 1.0;
                        } else {
                            // intersection is invalid
                            // mult = vec3(0.0);
                            intersectionPointAverage += vec4(ro + rd * 100.0, 1.0);
                            intersectionPointAverageSamples += 1.0;
                        }
                    

                        bool useTAA = true;
                        vec4 fragCol = vec4(0.0);
    
                        if(useTAA) {
                            float t = (accum * 0.1) * uAccumTimeFactor;

                            // exponential temporal average also depends on how rough the surface is
                            t *= pow(min(roughness / 0.175, 1.0), 0.5);


                            // vec3 oldSpecularDir = normalize(texture2D(uOldSSRUv, vUv + taaBuffer.xy).xyz);
                            // float specDot = dot(oldSpecularDir, specularReflectionDir);

                            // // if we moved the camera too much, lower t (taaBuffer has momentMove in uv space) 
                            // float dist = clamp(length(taaBuffer.xy) / 0.01, 0.0, 1.0);
                            // t *= 1.0 - dist;

                            // note that all of this is not perfect, since p2 should really be the "old" intersection
                            // point, but since we don't know it's moveDelta, we can't reproject the previous
                            // position so this will cause inaccurate results  
                            vec3 oldWorldPosition = texture2D(uOldPosition, vUv + taaBuffer.xy).xyz;
                            vec3 oldNormal        = normalize(texture2D(uOldNormal, vUv + taaBuffer.xy).xyz);
                            vec3 oldCameraPos = uOldCameraPos;

                            // vec3 repr_p;
                            // intersect(ro, specularReflectionDir, repr_p, lastP);

                            vec3 ssrp = find_reflection_incident_point(
                                 oldCameraPos, p2, oldWorldPosition, oldNormal);

                            if(!intersected) {
                                ssrp = find_reflection_incident_point(
                                    oldCameraPos, lastP, oldWorldPosition, oldNormal);

                                // ssrp = find_reflection_incident_point(
                                //     oldCameraPos, ro + specularReflectionDir * 100.0, oldWorldPosition, oldNormal);
                            }
                            
                            vec4 np = vProjectionMatrix * uOldViewMatrix * vec4(ssrp, 1.0);
                            np.xyzw /= np.w;
                            np.xy = np.xy * 0.5 + 0.5;

                            if(np.x < 0.0 || np.x > 1.0 || np.y < 0.0 || np.y > 1.0) {
                                np.xy = vUv + taaBuffer.xy;
                            }


                            // "oldSSR" non rappresenta più il vecchio ssr color, perchè ogni volta
                            // prendiamo il colore da un pixel diverso (perchè il ground è rough)
                            // prima invece prendevamo sempre "lo stesso" vecchio pixel, dato dalla proiezione
                            // also non considerare tutto quello che ho detto per vero, questa è una supposizione
                            // vec3 oldSSR = texture2D(uOldSSRColor, np.xy).xyz * 0.5 + texture2D(uOldSSRColor, vUv + taaBuffer.xy).xyz * 0.5;


                            vec3 oldSSR1;
                            for(int i = -1; i <= 1; i++) {
                                for(int j = -1; j <= 1; j++) {
                                    oldSSR1 += texture2D(uOldSSRColor, np.xy + vec2(0.0015 * float(i), 0.0015 * float(j))).xyz * (1.0 / 9.0);
                                }
                            }

                            // vec3 oldSSR2;
                            // for(int i = -1; i <= 1; i++) {
                            //     for(int j = -1; j <= 1; j++) {
                            //         oldSSR2 += texture2D(uOldSSRColor, vUv + taaBuffer.xy + vec2(0.0015 * float(i), 0.0015 * float(j))).xyz * (1.0 / 9.0);
                            //     }
                            // }

                            // vec3 oldSSR = texture2D(uOldSSRColor, np.xy).xyz * det + texture2D(uOldSSRColor, vUv + taaBuffer.xy).xyz * (1.0 - det);
                            vec3 oldSSR = oldSSR1 * det + texture2D(uOldSSRColor, vUv + taaBuffer.xy).xyz * (1.0 - det);
                            // vec3 oldSSR = oldSSR1 * det + oldSSR2 * (1.0 - det);



                            // vec3 oldSSR = texture2D(uOldSSRColor, vUv + taaBuffer.xy).xyz;


                            vec3 fresnel = fresnelSchlick(max(dot(rd, norm), 0.0), F0);

                            if(intersected) {
                                vec3 newCol = mult * (1.0 - t) + oldSSR * t;
                                sum += vec4(newCol, 0.0);
                            } else if(accum > 0.0) {
                                // this one makes a cool effect too
                                // sum += vec4(oldSSR, 0.0);

                                vec3 envColor = getEnvmapRadiance(rd) * fresnel * (1.0 - t) + oldSSR * t; 
                                // effectiveSamples -= 1;
                                sum += vec4(envColor, 0.0);
                            } else {
                                vec3 envColor = getEnvmapRadiance(rd) * fresnel * (1.0 - t) + oldSSR * t; 
                                // effectiveSamples -= 1;
                                sum += vec4(envColor, 0.0);
                            }
                        } else {
                            if(intersected) {
                                sum += vec4(mult, 0.0);
                            }
                        }
                    }

                    sum /= float(effectiveSamples);

                    out_SSRColor        = vec4(sum.xyz, 1.0);
                    out_SSRIntersection = intersectionPointAverage / max(intersectionPointAverageSamples, 1.0);
                }
            `,
            glslVersion: THREE.GLSL3,
            depthTest:  false,
            depthWrite: false,
        });


        this.applySSRMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uSSR:       { type: "t", value: null },
                uColor:     { type: "t", value: colorRT.texture },
                uAlbedo:    { type: "t", value: albedoTexture },
                uMaterial:  { type: "t", value: materialTexture },
                uPosition:  { type: "t", value: positionTexture },
                uNormal:    { type: "t", value: normalTexture },
                uCameraPos: { value: new THREE.Vector3(0,0,0) },
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
                uniform sampler2D uMaterial;
                uniform sampler2D uAlbedo;
                uniform sampler2D uPosition;
                uniform sampler2D uNormal;

                uniform vec3 uCameraPos;

                varying vec2 vUv;

                vec3 fresnelSchlick(float cosTheta, vec3 F0) {
                    return F0 + (1.0 - F0) * pow(max(1.0 - cosTheta, 0.0), 5.0);
                }

                void main() {
                    vec3 ssr      = texture2D(uSSR, vUv).xyz;
                    vec3 col      = texture2D(uColor, vUv).xyz;
                    vec3 material = texture2D(uMaterial, vUv).xyz;
                    vec3 albedo   = texture2D(uAlbedo, vUv).xyz;
                    vec3 pos      = texture2D(uPosition, vUv).xyz;
                    vec3 norm     = normalize(texture2D(uNormal, vUv).xyz);

                    vec3 viewDir = normalize(pos - uCameraPos);

                    // float metalness = material.y;
                    // float baseF0 = material.z;
                    // vec3 F0 = vec3(baseF0);
                    // F0 = mix(F0, albedo.xyz, metalness);

                    // vec3 F = fresnelSchlick(max(dot(norm, -viewDir), 0.0), F0);

                    // vec3 kS = F;

                    // we don't have to apply these modifiers since they have already been applied by MeshStandardMaterial in the color pass
                    // vec3 kD = 1.0 - kS;
                    // vec3 kD = (1.0 - metalness) * (1.0 - kS);
                    // vec3 kD = vec3(1.0 - metalness);
                    // vec3 kD = vec3(1.0) * (1.0 - kS);
                    vec3 kD = vec3(1.0);

                    // notice that we already applied ACESFilmicToneMapping to ssr in the ssr pass, 
                    // we're reapplying it again because if we dont the variance is just too high
                    // I think that applying it in the ssr pass makes it so that the accumulated values
                    // are applied on numbers over a small range and that helps in reducing substantially the variance 

                    vec3 finalLinear = col * kD + ssr * ${postReflMult};
                    // vec3 finalLinear = col * kD;

                    vec3 final = ACESFilmicToneMapping(finalLinear);
                    final = pow(final, vec3(2.2)); 

                    gl_FragColor = vec4(final, 1.0);
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

        this.lastViewMatrixInverse = this.sceneCamera.matrixWorldInverse.clone();
        this.lastCameraPos = this.sceneCamera.position.clone();

        this.clock = new THREE.Clock();
        this.blueNoiseIndex = new THREE.Vector4(0,0,0,0);
    }

    compute(TAART, envmap, options) {
        this.SSRRT.swap();
        this.renderer.setRenderTarget(this.SSRRT.write);

        this.mesh.material = this.material;
        this.material.uniforms.uOldViewMatrix.value = this.lastViewMatrixInverse;
        this.material.uniforms.uOldCameraPos.value.set(this.lastCameraPos.x, this.lastCameraPos.y, this.lastCameraPos.z);
        this.material.uniforms.uCameraPos.value    = this.sceneCamera.position;
        this.material.uniforms.uCameraTarget.value = this.controls.target;
        this.material.uniforms.uOldSSRColor.value  = this.SSRRT.read.texture[0];
        this.material.uniforms.uOldSSRUv.value     = this.SSRRT.read.texture[1];
        this.material.uniforms.uTAA.value     = TAART;
        this.material.uniforms.uUncompressedEnv.value = options.uncompressedEnv;
        this.material.uniforms.uSamples.value = options.samples;
        this.material.uniforms.uEnvmap.value  = envmap;
        this.material.uniforms.uRandoms.value = new THREE.Vector4(Math.random(), Math.random(), Math.random(), Math.random());
        this.material.uniforms.uTime.value = this.clock.getElapsedTime();
        this.material.uniforms.uAccumTimeFactor.value = options.accumTimeFactor;
        // this.blueNoiseIndex.setX(++this.blueNoiseIndex.x % 512);
        this.blueNoiseIndex.setX(Math.floor(Math.random() * 512));
        this.blueNoiseIndex.setY(Math.floor(Math.random() * 512));
        this.material.uniforms.uBlueNoiseIndex.value = this.blueNoiseIndex;
        this.renderer.render(this.scene, this.sceneCamera);

        this.renderer.setRenderTarget(null);
    }

    apply(ssrTexture, renderTargetDest) {
        this.renderer.setRenderTarget(renderTargetDest);

        this.mesh.material = this.applySSRMaterial;
        this.applySSRMaterial.uniforms.uSSR.value = ssrTexture;
        this.applySSRMaterial.uniforms.uCameraPos.value = this.sceneCamera.position;
        this.renderer.render(this.scene, this.sceneCamera);

        this.renderer.setRenderTarget(null);


        this.lastViewMatrixInverse = this.sceneCamera.matrixWorldInverse.clone();
        this.lastCameraPos = this.sceneCamera.position.clone();
    }
}

export let SSRMaterial = function(args) {
    let baseMaterial = new THREE.MeshStandardMaterial(args);
    baseMaterial.baseF0 = args.baseF0;
    baseMaterial.meshId = args.meshId;

    // remove envmap reflections from this material (we could also remove analytical lights but we decided to keep them for now)
    baseMaterial.onBeforeCompile = (shader) => {
        // "unroll" the entire shader
        shader.fragmentShader = Utils.parseIncludes(shader.fragmentShader); 

        shader.fragmentShader = shader.fragmentShader.replace(
            // line to replace...
            "radiance += getLightProbeIndirectRadiance( geometry.viewDir, geometry.normal, material.specularRoughness, maxMipLevel );", 
            "", 
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            // line to replace...
            "BRDF_Specular_Multiscattering_Environment( geometry, material.specularColor, material.specularRoughness, singleScattering, multiScattering );", 
            "", 
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            "reflectedLight.indirectSpecular += multiScattering * cosineWeightedIrradiance;",
            "reflectedLight.indirectSpecular = vec3(0.0);",
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            "gl_FragColor.rgb = toneMapping( gl_FragColor.rgb );",
            "",
        );

        shader.fragmentShader = shader.fragmentShader.replace(
            "gl_FragColor = linearToOutputTexel( gl_FragColor );",
            "",
        );

        // shader.fragmentShader = shader.fragmentShader.replace(
        //     "reflectedLight.indirectDiffuse += diffuse * cosineWeightedIrradiance;",
        //     "",
        // );
    };

    return baseMaterial;
}