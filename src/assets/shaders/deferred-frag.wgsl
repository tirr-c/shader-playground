struct PointLights {
  num_valid: u32,
  @align(256)
  data: array<PointLight>,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@group(1) @binding(0) var gbuffer_albedo: texture_multisampled_2d<f32>;
@group(1) @binding(1) var gbuffer_normal: texture_multisampled_2d<f32>;
@group(1) @binding(2) var gbuffer_material: texture_multisampled_2d<u32>;
@group(1) @binding(3) var gbuffer_depth: texture_depth_multisampled_2d;

@group(2) @binding(0) var<storage, read> point_lights: PointLights;
@group(2) @binding(1) var shadow_texture: texture_depth_2d_array;
@group(2) @binding(2) var shadow_sampler: sampler_comparison;

fn world_from_screen(pos_screen: vec2f, depth: f32) -> vec3f {
  let pos_clip = vec4(pos_screen.x * 2.0 - 1.0, (1.0 - pos_screen.y) * 2.0 - 1.0, depth, 1.0);
  let pos_world_w = uniforms.view_proj_mat_inv * pos_clip;
  let pos_world = pos_world_w.xyz / pos_world_w.www;
  return pos_world;
}

// All vectors should be normalized
fn scattering_pdf(material: u32, n: vec4f, incident_ray: vec4f, scatter_ray: vec4f) -> f32 {
  switch (material) {
    case MATERIAL_LAMBERTIAN: {
      // Lambertian diffuse material
      let diffuse_theta = max(dot(n, scatter_ray), 0.0);
      return diffuse_theta / 3.14159265;
    }
    default: {
      return 0.0;
    }
  }
}

fn compute_intensity(
  light: PointLight,
  pos_world: vec3f,
  normal: vec3f,
  material: u32,
) -> vec3f {
  let light_pos_v = uniforms.view_mat * vec4(light.pos, 1.0);
  let light_dir_v = uniforms.view_mat * vec4(light.dir_and_half_theta.xyz, 0.0);
  let light_dir_v_norm = normalize(light_dir_v);
  let light_half_theta_upper_cos = cos(light.dir_and_half_theta.w);
  let light_half_theta_lower_cos = cos(light.dir_and_half_theta.w * 1.1);
  let position_v = uniforms.view_mat * vec4f(pos_world, 1.0);

  let n_norm = vec4f(normalize(normal), 0.0);
  let light_ray_v = position_v - light_pos_v;
  let light_ray_v_norm = normalize(light_ray_v);
  let spotlight_strength = smoothstep(
    light_half_theta_lower_cos,
    light_half_theta_upper_cos,
    dot(light_ray_v_norm, light_dir_v_norm),
  );
  let light_dist_sq = dot(light_ray_v, light_ray_v);
  let light_strength = spotlight_strength * max(dot(n_norm, -light_ray_v_norm), 0.0) / light_dist_sq;

  //let scatter_ray_v = normalize(-position_v);
  let scatter_ray_v = vec4(0.0, 0.0, 1.0, 0.0);
  let pdf = scattering_pdf(material, n_norm, light_ray_v_norm, scatter_ray_v);
  return light.color_intensity * (pdf * light_strength);
}

@fragment
fn main(
  @builtin(position) position: vec4f,
  @builtin(sample_index) sample_index: u32,
) -> @location(0) vec4f {
  let gbuffer_sample_pos = vec2i(floor(position.xy));

  let depth = textureLoad(
    gbuffer_depth,
    gbuffer_sample_pos,
    sample_index,
  );

  // Don't light the sky
  if (depth >= 1.0) {
    discard;
  }

  let buffer_size = textureDimensions(gbuffer_depth);
  let pos_screen = position.xy / vec2f(buffer_size);
  let pos_world = world_from_screen(pos_screen, depth);

  let normal = textureLoad(
    gbuffer_normal,
    gbuffer_sample_pos,
    sample_index,
  ).xyz;
  let albedo = textureLoad(
    gbuffer_albedo,
    gbuffer_sample_pos,
    sample_index,
  );
  let material = textureLoad(
    gbuffer_material,
    gbuffer_sample_pos,
    sample_index,
  ).x;

  var intensity: vec3f = vec3f(0.0);
  for (var light_idx: u32 = 0; light_idx < point_lights.num_valid; light_idx += 1) {
    let light = point_lights.data[light_idx];
    let scatter_intensity = compute_intensity(light, pos_world, normal, material);

    // Sample from shadow map with perspective correction
    let shadow_pos_raw = light.view_proj_mat * vec4f(pos_world, 1.0);
    let shadow_pos = shadow_pos_raw.xyz / shadow_pos_raw.www;
    let shadow_xy = shadow_pos.xy * vec2(0.5, -0.5) + vec2(0.5);
    let light_depth = shadow_pos.z;
    let visibility = textureSampleCompare(
      shadow_texture,
      shadow_sampler,
      shadow_xy,
      light_idx,
      light_depth - 0.001,
    );

    intensity += scatter_intensity * visibility;
  }

  return albedo * vec4f(intensity, 1.0);
}
