struct Objects {
  mat: mat4x4f,
}

struct Uniforms {
  view_mat: mat4x4f,
  proj_mat: mat4x4f,
  proj_mat_inv: mat4x4f,
}

struct Light {
  pos: vec4f,
  intensity: f32,
}

@group(0) @binding(0) var<uniform> objects: Objects;
@group(0) @binding(1) var boxSampler: sampler;
@group(0) @binding(2) var boxTexture: texture_2d<f32>;

@group(1) @binding(0) var<uniform> uniforms: Uniforms;
@group(1) @binding(1) var<uniform> lights: array<Light, 4>;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) n: vec4f,
  @location(1) uv: vec2f,
  @location(2) position_v: vec4f,
}

@vertex
fn vertex_main(
  @location(0) position: vec4f,
  @location(1) n: vec4f,
  @location(2) uv: vec2f,
) -> VertexOut {
  let view_mat: mat4x4f = uniforms.view_mat * objects.mat;
  let proj_mat: mat4x4f = uniforms.proj_mat * view_mat;
  var output: VertexOut;
  output.position = proj_mat * position;
  output.n = view_mat * n;
  output.uv = uv;
  output.position_v = view_mat * position;
  return output;
}

// All vectors should be normalized
fn scattering_pdf(n: vec4f, incident_ray: vec4f, scatter_ray: vec4f) -> f32 {
  let r: vec4f = reflect(incident_ray, n);
  let diffuse_theta = max(dot(n, scatter_ray), 0.0) * 0.0;
  let specular_theta = max(dot(r, scatter_ray), 0.0) * 1.0;
  return (diffuse_theta + specular_theta) / 3.14159265;
}

fn compute_intensity(light: Light, frag_data: VertexOut) -> f32 {
  let light_pos_v = uniforms.view_mat * light.pos;
  let position_v = frag_data.position_v;
  var screen_p: vec4f = uniforms.proj_mat * position_v;
  screen_p.z = 0.0;
  screen_p.w = 0.5;
  let screen_v = uniforms.proj_mat_inv * screen_p;

  let n_norm = normalize(frag_data.n);
  let light_ray_v = position_v - light_pos_v;
  let light_ray_v_norm = normalize(light_ray_v);
  let light_dist_sq = dot(light_ray_v, light_ray_v);
  let light_strength = smoothstep(0.25, -0.05, dot(n_norm, light_ray_v_norm)) / light_dist_sq;

  let scatter_ray_v = normalize(screen_v - position_v);
  let pdf = scattering_pdf(n_norm, light_ray_v_norm, scatter_ray_v);
  return pdf * (light.intensity * light_strength);
}

@fragment
fn fragment_main(
  frag_data: VertexOut,
) -> @location(0) vec4f {
  let i0 = compute_intensity(lights[0], frag_data);
  let i1 = compute_intensity(lights[1], frag_data);
  let i2 = compute_intensity(lights[2], frag_data);
  let i3 = compute_intensity(lights[3], frag_data);
  let scatter_intensity = i0 + i1 + i2 + i3;

  let albedo: vec4f = textureSample(boxTexture, boxSampler, frag_data.uv);
  let intensity: vec4f = vec4(
    scatter_intensity,
    scatter_intensity,
    scatter_intensity,
    1.0,
  );
  return albedo * intensity;
}
