@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@group(1) @binding(0) var gbuffer_albedo: texture_multisampled_2d<f32>;
@group(1) @binding(1) var gbuffer_normal: texture_multisampled_2d<f32>;
@group(1) @binding(2) var gbuffer_depth: texture_depth_multisampled_2d;
@group(1) @binding(3) var gbuffer_material: texture_multisampled_2d<u32>;

@group(2) @binding(0) var<uniform> num_point_lights: u32;
@group(2) @binding(1) var<storage, read> point_lights: array<PointLight>;
@group(2) @binding(2) var shadow_texture: texture_depth_2d_array;
@group(2) @binding(3) var shadow_sampler: sampler_comparison;

fn world_from_screen(pos_screen: vec2f, depth: f32) -> vec3f {
  let pos_clip_xy = (vec2(0.5) - pos_screen.xy) * vec2(-2.0, 2.0);
  let pos_clip = vec4(pos_clip_xy, depth, 1.0);
  let pos_world_w = uniforms.view_proj_mat_inv * pos_clip;
  let pos_world = pos_world_w.xyz / pos_world_w.www;
  return pos_world;
}

// All vectors should be normalized
fn scattering_pdf(material: u32, normal_w: vec3f, incident_w: vec3f) -> f32 {
  switch (material) {
    case MATERIAL_LAMBERTIAN: {
      // Lambertian diffuse material
      return max(dot(normal_w, -incident_w), 0.0) / 3.14159265;
    }
    default: {
      return 0.0;
    }
  }
}

fn compute_intensity(
  light: PointLight,
  pos_w: vec3f,
  normal_w_norm: vec3f,
  material: u32,
) -> vec3f {
  let light_pos_w = light.pos;
  let light_dir_w_norm = light.dir_and_half_theta.xyz;
  let light_half_theta_upper_cos = cos(light.dir_and_half_theta.w);
  let light_half_theta_lower_cos = cos(light.dir_and_half_theta.w * 1.1);

  let light_ray_w = pos_w - light_pos_w;
  let light_ray_w_norm = normalize(light_ray_w);

  let spotlight_strength = smoothstep(
    light_half_theta_lower_cos,
    light_half_theta_upper_cos,
    dot(light_ray_w_norm, light_dir_w_norm),
  );
  let light_dist_sq = dot(light_ray_w, light_ray_w);
  let light_strength = spotlight_strength / light_dist_sq;
  let pdf = scattering_pdf(material, normal_w_norm, light_ray_w_norm);
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
  let pos_w = world_from_screen(pos_screen, depth);

  let normal_w = textureLoad(
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
  for (var light_idx: u32 = 0; light_idx < num_point_lights; light_idx += 1) {
    let light = point_lights[light_idx];

    // Sample from shadow map with perspective correction
    let shadow_pos_raw = light.view_proj_mat * vec4f(pos_w, 1.0);
    let shadow_pos = shadow_pos_raw.xyz / shadow_pos_raw.www;
    let shadow_xy = shadow_pos.xy * vec2(0.5, -0.5) + vec2(0.5);
    let light_depth = shadow_pos.z - 0.001;
    let visibility = textureSampleCompare(
      shadow_texture,
      shadow_sampler,
      shadow_xy,
      light_idx,
      light_depth,
    );

    var local_intensity = vec3(0.0);
    if (visibility > 0.0) {
      local_intensity = compute_intensity(light, pos_w, normal_w, material) * visibility;
    }

    intensity += local_intensity;
  }

  return albedo * vec4f(intensity, 1.0);
}
